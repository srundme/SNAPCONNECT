import { assertAllowedUrl } from "./hosts";

export type ZohoResult =
  | { status: "SUCCESS"; crmId: string; simulated: boolean }
  | { status: "RETRYABLE"; error: string; simulated: boolean }
  | { status: "FAILED"; error: string; simulated: boolean }
  | { status: "UNKNOWN"; error: string; simulated: boolean };

export type ZohoAdapter = {
  mode: "SIMULATION" | "INTEGRATION";
  upsert(input: { apiDomain: string; token: string; record: Record<string, string>; duplicateCheckFields: string[]; existingId?: string | null; trigger: string[] }): Promise<ZohoResult>;
  /** The lead's current values for these fields, to avoid overwriting what the team filled in Zoho. Null when it cannot be read. */
  fetchFields?(input: { apiDomain: string; token: string; id: string; fields: string[] }): Promise<Record<string, string> | null>;
};

const sink = new Map<string, Record<string, string>>();

export function simulationZoho(): ZohoAdapter {
  return {
    mode: "SIMULATION",
    async upsert(input) {
      const id = input.existingId ?? `sim-crm-${input.record.External_Lead_Key ?? input.record.External_Lead_Key__c ?? input.record.Last_Name}`;
      sink.set(id, { ...(input.existingId ? sink.get(id) : {}), ...input.record });
      return { status: "SUCCESS", crmId: id, simulated: true };
    },
    async fetchFields(input) {
      const record = sink.get(input.id);
      if (!record) return null;
      return Object.fromEntries(input.fields.map((field) => [field, record[field] ?? ""]));
    },
  };
}

/** For tests: what the team typed into the simulated Zoho record. */
export function editSimulationCrm(id: string, fields: Record<string, string>): void {
  sink.set(id, { ...(sink.get(id) ?? {}), ...fields });
}

export function readSimulationCrm(id: string): Record<string, string> | undefined {
  return sink.get(id);
}

export class ZohoOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZohoOAuthError";
  }
}

async function zohoTokenRequest(accountsUrl: string, body: URLSearchParams, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  const accounts = assertAllowedUrl(accountsUrl, "zoho-accounts");
  const response = await fetchImpl(new URL("/oauth/v2/token", accounts), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok || payload.error) {
    throw new ZohoOAuthError(`Zoho refused the token request${payload.error ? `: ${String(payload.error)}` : "."}`);
  }
  return payload;
}

export async function exchangeZohoCode(options: {
  accountsUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  fetchImpl?: typeof fetch;
}): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date; apiDomain: string }> {
  const payload = await zohoTokenRequest(options.accountsUrl, new URLSearchParams({
    grant_type: "authorization_code",
    client_id: options.clientId,
    client_secret: options.clientSecret,
    redirect_uri: options.redirectUri,
    code: options.code,
  }), options.fetchImpl ?? fetch);
  const accessToken = String(payload.access_token ?? "");
  const refreshToken = String(payload.refresh_token ?? "");
  const apiDomain = String(payload.api_domain ?? "");
  if (!accessToken || !refreshToken || !apiDomain) throw new ZohoOAuthError("Zoho did not return a refresh token and API domain.");
  const seconds = Number(payload.expires_in ?? 3600);
  return { accessToken, refreshToken, apiDomain, expiresAt: new Date(Date.now() + Math.max(60, seconds) * 1000) };
}

export async function refreshZohoAccess(options: {
  accountsUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<{ accessToken: string; expiresAt: Date; apiDomain: string | null }> {
  const payload = await zohoTokenRequest(options.accountsUrl, new URLSearchParams({
    grant_type: "refresh_token",
    client_id: options.clientId,
    client_secret: options.clientSecret,
    refresh_token: options.refreshToken,
  }), options.fetchImpl ?? fetch);
  const accessToken = String(payload.access_token ?? "");
  if (!accessToken) throw new ZohoOAuthError("Zoho did not return an access token.");
  const seconds = Number(payload.expires_in ?? 3600);
  return {
    accessToken,
    apiDomain: payload.api_domain ? String(payload.api_domain) : null,
    expiresAt: new Date(Date.now() + Math.max(60, seconds) * 1000),
  };
}

export function zohoAdapter(fetchImpl: typeof fetch = fetch): ZohoAdapter {
  return {
    mode: "INTEGRATION",
    async upsert(input) {
      const api = assertAllowedUrl(input.apiDomain, "zoho-api");
      const path = input.existingId ? `/crm/v8/Leads/${input.existingId}` : "/crm/v8/Leads/upsert";
      try {
        const response = await fetchImpl(`${api.origin}${path}`, {
          method: input.existingId ? "PUT" : "POST",
          headers: { Authorization: `Zoho-oauthtoken ${input.token}`, "content-type": "application/json" },
          body: JSON.stringify({
            data: [input.record],
            duplicate_check_fields: input.duplicateCheckFields,
            trigger: input.trigger,
          }),
          signal: AbortSignal.timeout(20_000),
        });
        const text = await response.text();
        if (response.status === 429 || response.status >= 500) return { status: "RETRYABLE", error: `HTTP ${response.status}`, simulated: false };
        if (!response.ok) return { status: "FAILED", error: `HTTP ${response.status}`, simulated: false };
        const body = JSON.parse(text) as { data?: Array<{ code?: string; details?: { id?: string }; status?: string }> };
        const row = body.data?.[0];
        if (!row || row.status === "error") return { status: "FAILED", error: "Zoho returned an error inside a successful HTTP response.", simulated: false };
        const id = row.details?.id ?? input.existingId;
        if (!id) return { status: "UNKNOWN", error: "Zoho did not return a record id.", simulated: false };
        return { status: "SUCCESS", crmId: id, simulated: false };
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (name === "TimeoutError" || name === "AbortError") return { status: "UNKNOWN", error: "Zoho timed out.", simulated: false };
        return { status: "RETRYABLE", error: "Zoho could not be reached.", simulated: false };
      }
    },
    async fetchFields(input) {
      const api = assertAllowedUrl(input.apiDomain, "zoho-api");
      const fields = input.fields.filter((field) => /^[A-Za-z0-9_]+$/.test(field));
      if (!fields.length) return {};
      try {
        const response = await fetchImpl(`${api.origin}/crm/v8/Leads/${encodeURIComponent(input.id)}?fields=${fields.join(",")}`, {
          headers: { Authorization: `Zoho-oauthtoken ${input.token}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) return null;
        const body = (await response.json()) as { data?: Array<Record<string, unknown>> };
        const row = body.data?.[0];
        if (!row) return null;
        return Object.fromEntries(fields.map((field) => {
          const value = row[field];
          return [field, value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value)];
        }));
      } catch {
        return null;
      }
    },
  };
}
