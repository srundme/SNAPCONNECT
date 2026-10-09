import { VARUN_PROMPT, agentToggles, defaultZohoField, externalLeadKeyField, MAX_LEAD_QUESTIONS, parseAgentSettings, parseLeadQuestions } from "@snapsocial/domain";
import { getPrisma } from "@snapsocial/db";
import { AgentForm } from "@/components/lead-formation";
import { Empty, Notice, PageTitle } from "@/components/ui";
import { saveAiSettings } from "@/lib/actions";
import { requireWorkspace } from "@/lib/session";

export default async function AiPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const params = await searchParams;
  const { workspace, role } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;
  if (role === "VIEWER") return <Empty title="Permission denied" body="The agent setup is hidden from viewers." />;
  const canEdit = role === "ADMIN" || role === "SUPER_ADMIN";
  const questions = parseLeadQuestions(workspace.leadQuestions);
  const settings = parseAgentSettings(workspace.agentSettings);
  const zoho = await getPrisma().zohoConnection.findUnique({ where: { workspaceId: workspace.id } });
  const externalKey = externalLeadKeyField(zoho?.externalKeyField ?? "External_Lead_Key");
  return (
    <section>
      <PageTitle title="Agent" detail="Set who replies, what it knows, how it behaves, and which answers become the Zoho lead." />
      {params.saved ? <Notice tone="ok">Saved. The next reply uses this.</Notice> : null}
      {params.error ? <Notice tone="stop">{params.error}</Notice> : null}
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
            knowledgeBase={workspace.knowledgeBase}
            maxQuestions={MAX_LEAD_QUESTIONS}
            settings={{
              projectAliases: settings.projectAliases,
              goal: settings.goal,
              pricingAnswer: settings.pricingAnswer,
              workingHours: settings.workingHours,
              serviceArea: settings.serviceArea,
              holidays: settings.holidays,
              complaintContact: settings.complaintContact,
              rules: settings.rules,
              realityChecks: settings.realityChecks,
              designKnowledge: settings.designKnowledge,
              zohoCompanyFallback: settings.zohoCompanyFallback,
              hotBudgetLakhs: settings.hotBudgetLakhs,
              zohoRatingField: settings.zohoRatingField,
              followUpHours: settings.followUpHours,
              alertNumbers: settings.alertNumbers,
              alertTemplate: settings.alertTemplate,
              alertTemplateLanguage: settings.alertTemplateLanguage,
              summaryNumbers: settings.summaryNumbers,
              summaryTemplate: settings.summaryTemplate,
              completedProjects: settings.completedProjects,
              brainPrompt: settings.brainPrompt.trim() || VARUN_PROMPT,
              brainPromptCustom: Boolean(settings.brainPrompt.trim()),
              toggles: Object.fromEntries(agentToggles.map((key) => [key, settings[key]])),
            }}
            questions={questions.map((question) => ({ label: question.label, zohoField: question.zohoField ?? defaultZohoField(question), required: question.required }))}
          />
      ) : (
        <dl className="grid max-w-xl gap-3 text-sm">
          <div><dt className="font-semibold">Brand</dt><dd>{workspace.brandName}</dd></div>
          <div><dt className="font-semibold">Agent</dt><dd>{workspace.agentName || "Not set"}</dd></div>
          <div><dt className="font-semibold">Persona</dt><dd>{workspace.agentPersona || "Not set"}</dd></div>
          <div><dt className="font-semibold">Goal</dt><dd>{settings.goal}</dd></div>
          <div><dt className="font-semibold">Knowledge base</dt><dd>{workspace.knowledgeBase ? `${workspace.knowledgeBase.length.toLocaleString("en-IN")} characters` : "Not set"}</dd></div>
          {questions.map((question) => <div key={question.id}><dt className="font-semibold">{question.label}</dt><dd>{question.zohoField ?? "Description"}{question.required ? "" : " (nice to have)"}</dd></div>)}
        </dl>
      )}
    </section>
  );
}
