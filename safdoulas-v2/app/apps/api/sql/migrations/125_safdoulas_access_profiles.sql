-- SafDoulas-only role templates. Assign these roles globally for their base
-- capabilities and to exact extension_record scopes for process participation.
INSERT INTO access_roles(id,name,permissions) VALUES
  ('safdoulas_federation_governance','FENADOULASBR — Governança',ARRAY[
    'plugin.safdoulas-governance.manage','plugin.safdoulas-registry.manage','plugin.safdoulas-processes.manage',
    'plugin.safdoulas-accreditors.manage','plugin.safdoulas-triage.manage','plugin.safdoulas-blinding.manage',
    'plugin.safdoulas-assessments.manage','plugin.safdoulas-diligences.manage','plugin.safdoulas-decisions.manage',
    'plugin.safdoulas-accreditation.manage','plugin.safdoulas-reporting.manage','plugin.safdoulas-public-portal.manage'
  ]),
  ('safdoulas_directorate','Diretoria',ARRAY[
    'plugin.safdoulas-governance.read','plugin.safdoulas-registry.read','plugin.safdoulas-processes.read',
    'plugin.safdoulas-processes.transition.deliberator','plugin.safdoulas-processes.transition.secretariat',
    'plugin.safdoulas-decisions.read','plugin.safdoulas-decisions.write','plugin.safdoulas-decisions.manage',
    'plugin.safdoulas-accreditation.read','plugin.safdoulas-reporting.read','plugin.safdoulas-reporting.export'
  ]),
  ('safdoulas_workgroup','Grupo de Trabalho de Acreditação',ARRAY[
    'plugin.safdoulas-processes.read','plugin.safdoulas-processes.write','plugin.safdoulas-processes.transition.screener',
    'plugin.safdoulas-processes.transition.secretariat','plugin.safdoulas-triage.read','plugin.safdoulas-triage.write',
    'plugin.safdoulas-triage.publish','plugin.safdoulas-blinding.read','plugin.safdoulas-blinding.write',
    'plugin.safdoulas-blinding.publish','plugin.safdoulas-assessments.read','plugin.safdoulas-diligences.read',
    'plugin.safdoulas-reporting.read'
  ]),
  ('safdoulas_accreditor','Acreditadora',ARRAY[
    'plugin.safdoulas-accreditors.read','plugin.safdoulas-accreditors.write','plugin.safdoulas-processes.read',
    'plugin.safdoulas-processes.transition.evaluator','plugin.safdoulas-blinding.read',
    'plugin.safdoulas-assessments.read','plugin.safdoulas-assessments.write','plugin.safdoulas-reporting.read'
  ]),
  ('safdoulas_accreditor_candidate','Candidata a Acreditadora',ARRAY[
    'plugin.safdoulas-accreditors.read','plugin.safdoulas-accreditors.write','plugin.safdoulas-processes.read',
    'plugin.safdoulas-processes.transition.accreditor_candidate','plugin.forms.read','plugin.forms.write',
    'plugin.documents.read','plugin.documents.write','plugin.terms.read','plugin.terms.write'
  ]),
  ('safdoulas_institution','Instituição ou Formadora',ARRAY[
    'plugin.safdoulas-registry.read','plugin.safdoulas-registry.write','plugin.safdoulas-processes.read',
    'plugin.safdoulas-processes.write','plugin.safdoulas-processes.transition.applicant','plugin.forms.read',
    'plugin.forms.write','plugin.documents.read','plugin.documents.write','plugin.privacy.read',
    'plugin.safdoulas-accreditation.read','plugin.safdoulas-decisions.read','plugin.safdoulas-reporting.read'
  ]),
  ('safdoulas_institution_representative','Representante da Instituição',ARRAY[
    'plugin.safdoulas-registry.read','plugin.safdoulas-registry.write','plugin.safdoulas-processes.read',
    'plugin.safdoulas-processes.write','plugin.safdoulas-processes.transition.applicant',
    'plugin.safdoulas-processes.transition.institution_representative','plugin.forms.read','plugin.forms.write',
    'plugin.documents.read','plugin.documents.write','plugin.privacy.read','plugin.safdoulas-diligences.read',
    'plugin.safdoulas-diligences.write','plugin.safdoulas-accreditation.read','plugin.safdoulas-accreditation.write',
    'plugin.safdoulas-decisions.read','plugin.safdoulas-reporting.read'
  ]),
  ('safdoulas_observer','Observador',ARRAY[
    'plugin.safdoulas-processes.read','plugin.safdoulas-accreditation.read','plugin.safdoulas-reporting.read'
  ]),
  ('safdoulas_public_user','Usuário Público — sem acesso interno',ARRAY[]::text[])
ON CONFLICT (id) DO NOTHING;
