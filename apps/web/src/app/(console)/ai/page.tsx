import { getPrisma } from "@snapsocial/db";
import { resolveReplyPrompts, replyPromptFields } from "@snapsocial/domain";
import { Empty, PageTitle, StatusLabel } from "@/components/ui";
import { saveAiSettings } from "@/lib/actions";
import { requireWorkspace } from "@/lib/session";

const promptLabels: Record<(typeof replyPromptFields)[number], string> = {
  projectType: "Home or commercial",
  city: "City",
  requirement: "Work needed",
  budget: "Budget",
  timeframe: "Start time",
  phone: "Phone",
  whatsapp: "WhatsApp",
  permission: "Permission to contact",
  closing: "Closing",
};

export default async function AiPage() {
  const { workspace, role } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;
  if (role === "VIEWER") return <Empty title="Permission denied" body="AI settings are hidden from viewers." />;
  const version = await getPrisma().aiConfigVersion.findFirst({ where: { workspaceId: workspace.id, active: true }, orderBy: { version: "desc" } });
  const runs = await getPrisma().aiRun.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "desc" }, take: 8 });
  const prompts = resolveReplyPrompts(workspace.replyPrompts);
  const canEdit = role === "ADMIN" || role === "SUPER_ADMIN";
  return (
    <section>
      <PageTitle title="AI settings" detail="The model writes each follow-up from the questions below. The first private reply stays on Posts & Rules." />
      <p className="text-sm">{version ? `Active configuration version ${version.version}` : "No activated configuration."}</p>
      <p className="mt-2"><StatusLabel tone={process.env.LLM_MODE === "ollama" ? "ok" : "sim"}>{process.env.LLM_MODE === "ollama" ? "Ollama" : "Labelled fixture extractor"}</StatusLabel></p>
      {canEdit ? (
        <form className="mt-6 grid max-w-xl gap-4" action={saveAiSettings}>
          <label>Brand name<input name="brandName" defaultValue={workspace.brandName} /></label>
          <label>Services<input name="services" defaultValue={workspace.services} /></label>
          <label>Tone<input name="tone" defaultValue={workspace.tone} /></label>
          <h2 className="pt-2 text-[19px] font-semibold tracking-tight">Follow-up questions</h2>
          {replyPromptFields.map((field) => (
            <label key={field}>{promptLabels[field]}
              <textarea name={field} defaultValue={prompts[field]} rows={2} />
            </label>
          ))}
          <button className="w-fit border-transparent bg-[var(--color-accent)] text-white hover:bg-[#115e59]" type="submit">Save questions</button>
        </form>
      ) : (
        <dl className="mt-6 grid max-w-xl gap-3 text-sm">
          <div><dt className="font-semibold">Brand</dt><dd>{workspace.brandName}</dd></div>
          <div><dt className="font-semibold">Services</dt><dd>{workspace.services}</dd></div>
          <div><dt className="font-semibold">Tone</dt><dd>{workspace.tone}</dd></div>
          {replyPromptFields.map((field) => (
            <div key={field}><dt className="font-semibold">{promptLabels[field]}</dt><dd>{prompts[field]}</dd></div>
          ))}
        </dl>
      )}
      <h2 className="mt-6 font-semibold">Recent runs</h2>
      <ul className="mt-2 text-sm">{runs.map((run) => <li key={run.id}>{run.model} · {run.latencyMs} ms · {run.valid ? "valid" : "handed to staff"} {run.simulated ? "· simulated" : ""}</li>)}</ul>
    </section>
  );
}
