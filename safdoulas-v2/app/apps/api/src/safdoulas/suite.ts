import { safdoulasGovernancePlugin } from "./governance.plugin";
import { safdoulasRegistryPlugin } from "./registry.plugin";
import { safdoulasProcessesPlugin } from "./processes.plugin";
import { safdoulasAccreditorsPlugin } from "./accreditors.plugin";
import { safdoulasTriagePlugin } from "./triage.plugin";
import { safdoulasBlindingPlugin } from "./blinding.plugin";
import { safdoulasAssessmentsPlugin } from "./assessments.plugin";
import { safdoulasDiligencesPlugin } from "./diligences.plugin";
import { safdoulasDecisionsPlugin } from "./decisions.plugin";
import { safdoulasAccreditationPlugin } from "./accreditation.plugin";
import { safdoulasReportingPlugin } from "./reporting.plugin";
import { safdoulasPublicPortalPlugin } from "./public-portal.plugin";
import { safdoulasDataProtectionPlugin } from "./data-protection.plugin";
import { safdoulasCaseworkPlugin } from "./casework.plugin";

export const safdoulasPlugins = [safdoulasGovernancePlugin, safdoulasRegistryPlugin, safdoulasProcessesPlugin,
  safdoulasAccreditorsPlugin, safdoulasTriagePlugin, safdoulasBlindingPlugin, safdoulasAssessmentsPlugin,
  safdoulasDiligencesPlugin, safdoulasDecisionsPlugin, safdoulasAccreditationPlugin, safdoulasReportingPlugin,
  safdoulasPublicPortalPlugin, safdoulasDataProtectionPlugin, safdoulasCaseworkPlugin];
