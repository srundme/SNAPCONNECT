import { defaultZohoField, externalLeadKeyField, parseLeadQuestions } from "@snapsocial/domain";
import { getPrisma } from "@snapsocial/db";
import { AgentForm } from "@/components/lead-formation";
import { Empty, Notice, PageTitle } from "@/components/ui";
import { saveAiSettings } from "@/lib/actions";
import { requireWorkspace } from "@/lib/session";

export default async function AiPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const params = await searchParams;
  const { workspace, role } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;
  if (role === "VIEWER") return <Empty title="Permission denied" body="The agent setup is hidden from viewers." />;
  const canEdit = role === "ADMIN" || role === "SUPER_ADMIN";
  const questions = parseLeadQuestions(workspace.leadQuestions);
  const zoho = await getPrisma().zohoConnection.findUnique({ where: { workspaceId: workspace.id } });
  const externalKey = externalLeadKeyField(zoho?.externalKeyField ?? "External_Lead_Key");
  return (
    <section>
      <PageTitle title="Agent" detail="Set who replies, what it knows, and which answers become the Zoho lead." />
      {params.saved ? <Notice tone="ok">Saved. The next reply uses this.</Notice> : null}
      {canEdit ? (
          <AgentForm
            action={saveAiSettings}
            brandName={workspace.brandName}
            agentName={workspace.agentName ?? ""}
            services={workspace.services}
            tone={workspace.tone}
            persona={workspace.agentPersona ?? ""}
            systemPrompt={workspace.systemPrompt ?? ""}
            externalKey={externalKey}
            questions={questions.map((question) => ({ label: question.label, zohoField: question.zohoField ?? defaultZohoField(question) }))}
          />
      ) : (
        <dl className="grid max-w-xl gap-3 text-sm">
          <div><dt className="font-semibold">Brand</dt><dd>{workspace.brandName}</dd></div>
          <div><dt className="font-semibold">Agent</dt><dd>{workspace.agentName || "Not set"}</dd></div>
          <div><dt className="font-semibold">Persona</dt><dd>{workspace.agentPersona || "Not set"}</dd></div>
          <div><dt className="font-semibold">System prompt</dt><dd>{workspace.systemPrompt || "Not set"}</dd></div>
          {questions.map((question) => <div key={question.id}><dt className="font-semibold">{question.label}</dt><dd>{question.zohoField ?? "Description"}</dd></div>)}
        </dl>
      )}
    </section>
  );
}
