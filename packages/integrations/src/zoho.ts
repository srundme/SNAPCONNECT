import { assertAllowedUrl } from "./hosts";

export type ZohoResult =
  | { status: "SUCCESS"; crmId: string; simulated: boolean }
  | { status: "RETRYABLE"; error: string; simulated: boolean }
  | { status: "FAILED"; error: string; simulated: boolean }
  | { status: "UNKNOWN"; error: string; simulated: boolean };

export type ZohoAdapter = {
  mode: "SIMULATION" | "INTEGRATION";
  upsert(input: { apiDomain: string; token: string; record: Record<string, string>; duplicateCheckFields: string[]; existingId?: string | null; trigger: string[] }): Promise<ZohoResult>;
};

const sink = new Map<string, Record<string, string>>();

export function simulationZoho(): ZohoAdapter {
  return {
    mode: "SIMULATION",
    async upsert(input) {
      const id = input.existingId ?? `sim-crm-${input.record.External_Lead_Key__c ?? input.record.Last_Name}`;
      sink.set(id, { ...input.record });
      return { status: "SUCCESS", crmId: id, simulated: true };
    },
  };
}

export function readSimulationCrm(id: string): Record<string, string> | undefined {
  return sink.get(id);
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
  };
}
