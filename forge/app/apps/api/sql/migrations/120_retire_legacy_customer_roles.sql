-- Remove customer profiles seeded by immutable historical migration 065.
-- Keep 065 unchanged so already installed databases retain valid checksums.
DELETE FROM access_grants WHERE role_id IN ('federation_governance','formation_directorate','accreditation_workgroup','accreditor','accreditor_candidate','institution_representative');
DELETE FROM access_roles WHERE id IN ('federation_governance','formation_directorate','accreditation_workgroup','accreditor','accreditor_candidate','institution_representative');
