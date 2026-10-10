/** The KariGhars lead questions, shared by the brain tests. */
import type { LeadQuestion } from "@snapsocial/domain";

export const QUESTIONS: LeadQuestion[] = [
  { id: "name", kind: "name", label: "May I know your name?", required: true, zohoField: "Last_Name" },
  { id: "place", kind: "text", label: "Where is the home: which area, and what is the property name?", required: true, zohoField: "Project_Location" },
  { id: "home", kind: "text", label: "What kind of home is it: apartment, villa or independent house, and how many BHK?", required: true, zohoField: "Home_Type" },
  { id: "possession", kind: "text", label: "When do you get possession, or is the home already ready?", required: true, zohoField: "Possession" },
  { id: "phone", kind: "phone", label: "Which number should the team call you on?", required: true, zohoField: "Phone" },
  { id: "email", kind: "text", label: "Email for the team to share the details?", required: true, zohoField: "Email" },
];
