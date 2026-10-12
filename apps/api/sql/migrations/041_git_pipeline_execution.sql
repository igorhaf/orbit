ALTER TABLE git_pipeline_targets ADD COLUMN IF NOT EXISTS deployment_method varchar(16) NOT NULL DEFAULT 'provider';
ALTER TABLE git_pipeline_targets DROP CONSTRAINT IF EXISTS git_pipeline_targets_deployment_method_check;
ALTER TABLE git_pipeline_targets ADD CONSTRAINT git_pipeline_targets_deployment_method_check CHECK (deployment_method IN ('provider','ssh','git'));
ALTER TABLE git_pipeline_targets ADD COLUMN IF NOT EXISTS git_flow varchar(24) NOT NULL DEFAULT 'pipeline_only';
ALTER TABLE git_pipeline_targets DROP CONSTRAINT IF EXISTS git_pipeline_targets_git_flow_check;
ALTER TABLE git_pipeline_targets ADD CONSTRAINT git_pipeline_targets_git_flow_check CHECK (git_flow IN ('pipeline_only','commit_push','pull_push'));
