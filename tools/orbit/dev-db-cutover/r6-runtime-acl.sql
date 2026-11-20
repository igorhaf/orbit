-- NÃO EXECUTAR SEM APROVAÇÃO OPERACIONAL. Inclusão interna em transação.
-- Explicit grants for the prioritized DEV flows. Increase only with flow evidence.
SET LOCAL ROLE :"owner_role";

-- Login/session lookups, effective RBAC and bootstrap defaults.
GRANT SELECT ON public.users, public.access_roles, public.access_grants, public.access_groups,
  public.access_group_members, public.access_user_exceptions, public.access_permission_settings,
  public.instance_branding, public.authorized_board_members TO :"app_role";
GRANT INSERT (name,email,password_hash,email_verified),
  UPDATE (name,password_hash,disabled,session_version,email_verified,mfa_enabled,preferences)
  ON public.users TO :"app_role";
GRANT INSERT (id,name,permissions), UPDATE (name,permissions,defaults_initialized) ON public.access_roles TO :"app_role";
GRANT INSERT (user_id,role_id,scope_type,scope_id), DELETE ON public.access_grants TO :"app_role";
GRANT INSERT (name,permissions), UPDATE (name,permissions), DELETE ON public.access_groups TO :"app_role";
GRANT INSERT (group_id,user_id), DELETE ON public.access_group_members TO :"app_role";
GRANT INSERT (user_id,permission_id,effect), DELETE ON public.access_user_exceptions TO :"app_role";
GRANT INSERT (permission_id,enabled), UPDATE (enabled) ON public.access_permission_settings TO :"app_role";

-- Invitation, recovery and MFA lifecycle. Locks require an UPDATE grant on the locked relation.
GRANT SELECT (email_hash,window_started_at,requests), INSERT (email_hash,window_started_at,requests),
  UPDATE (window_started_at,requests) ON public.account_auth_limits TO :"app_role";
GRANT SELECT (id,user_id,token_hash,purpose,expires_at,consumed_at),
  INSERT (user_id,token_hash,purpose,expires_at), UPDATE (consumed_at)
  ON public.account_auth_tokens TO :"app_role";
GRANT SELECT (id,user_id,purpose,code_hash,attempts,created_at,expires_at,consumed_at,session_version),
  INSERT (id,user_id,purpose,code_hash,session_version,expires_at), UPDATE (attempts,consumed_at)
  ON public.auth_mfa_challenges TO :"app_role";

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_login_attempts, public.request_rate_limits TO :"app_role";
GRANT SELECT (id, user_id, logged_at, device_label), INSERT (user_id, device_label), DELETE
  ON public.auth_login_history TO :"app_role";
-- Initial backup scans and disabled tunnel reconciliation use these columns in the empty fixture.
GRANT SELECT (id, owner_id, plugin_id, external_account_id, display_name, credentials_encrypted,
  enabled, metadata, created_at) ON public.integration_connections TO :"app_role";
GRANT SELECT (owner_id, connection_id, auto_upload) ON public.backup_cloud_settings TO :"app_role";

-- AccessService.audit and its invoker trigger.
GRANT SELECT ON public.access_audit TO :"app_role";
GRANT INSERT (actor_id, action, target, scope_type, scope_id) ON public.access_audit TO :"app_role";
GRANT SELECT (event_hash, sequence_number),
  INSERT (sequence_number, source_audit_id, previous_hash, source_hash, event_hash)
  ON public.immutable_audit_events TO :"app_role";
GRANT USAGE ON SEQUENCE public.access_audit_id_seq,
  public.immutable_audit_events_sequence_number_seq,
  public.extension_protocol_seq TO :"app_role";

-- Base workspace/board/list/card operations. REST permission checks stay in the host.
GRANT SELECT, INSERT, UPDATE ON public.workspaces TO :"app_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_members, public.workspace_resources,
  public.boards, public.board_members, public.lists, public.cards TO :"app_role";
GRANT SELECT, INSERT, DELETE ON public.card_assignees TO :"app_role";
GRANT SELECT ON public.board_media, public.ai_projects, public.vault_items, public.card_contexts,
  public.card_labels, public.labels TO :"app_role";
GRANT SELECT (id,owner_id,title) ON public.notebooks TO :"app_role";
GRANT INSERT (board_id,reference_board_id) ON public.board_architecture_contracts TO :"app_role";
GRANT INSERT (actor_id,board_id,card_id,kind,body) ON public.activities TO :"app_role";
GRANT SELECT (board_id,user_id,visited_at), INSERT (board_id,user_id,visited_at), UPDATE (visited_at)
  ON public.board_visits TO :"app_role";
GRANT SELECT (board_id,user_id) ON public.board_watchers TO :"app_role";
GRANT SELECT (list_id,user_id) ON public.list_watchers TO :"app_role";
GRANT SELECT (card_id,user_id) ON public.card_watchers TO :"app_role";
GRANT SELECT (id,board_id,trello_board_name,enabled,last_error) ON public.trello_connections TO :"app_role";
GRANT SELECT (connection_id,orbit_list_id,trello_list_name) ON public.trello_list_mappings TO :"app_role";
GRANT SELECT (enabled,project_id,agent,executor,card_id) ON public.card_execution_configs TO :"app_role";
GRANT SELECT (type_id,scope_key,enabled) ON public.card_type_settings TO :"app_role";
GRANT SELECT (card_id,plugin_ids,card_type_id,data), INSERT (card_id,card_type_id), UPDATE (card_type_id)
  ON public.card_plugin_layouts TO :"app_role";
-- The record-card guard resolves mappings even for ordinary board routes.
GRANT SELECT (card_id,board_id,record_id,created_at) ON public.record_card_links TO :"app_role";
-- The invoker trigger projects a record state to its linked board list.
GRANT SELECT (board_id,phase_id,list_id) ON public.record_board_phases TO :"app_role";
GRANT SELECT (id,plugin_id,kind) ON public.extension_records TO :"app_role";
GRANT SELECT (card_id) ON public.comments, public.checklists TO :"app_role";
GRANT INSERT (card_id,revision,snapshot,content_hash) ON public.card_revisions TO :"app_role";
GRANT SELECT (card_id,completed) ON public.checklist_items TO :"app_role";
GRANT SELECT (user_id,card_id,kind,title,read_at,created_at) ON public.notifications TO :"app_role";

-- Base queue, worker transitions, logs and results. Only tested columns can be written.
GRANT SELECT,
  INSERT (card_id,project_id,user_id,agent,executor,action,input,request_key,card_revision),
  UPDATE (status,stage,worker_id,started_at,heartbeat_at,finished_at,error,metadata,output,cancel_requested)
  ON public.card_runs TO :"app_role";
GRANT SELECT (id,user_id,card_id,project_id,status,source,created_at,started_at,finished_at),
  UPDATE (status,error,finished_at) ON public.card_ai_runs TO :"app_role";
GRANT SELECT (comment_id,user_id,card_id,project_id,status,created_at,started_at,finished_at)
  ON public.card_ai_comment_jobs TO :"app_role";
GRANT SELECT (id,triggered_by,status,card_id,project_id,created_at,started_at,finished_at,pipeline_id)
  ON public.delivery_runs TO :"app_role";
GRANT SELECT (id,name) ON public.delivery_pipelines TO :"app_role";
GRANT SELECT (id,run_id,stage,message,created_at), INSERT (run_id,stage,message)
  ON public.card_run_logs TO :"app_role";
GRANT USAGE ON SEQUENCE public.card_run_logs_id_seq TO :"app_role";
GRANT SELECT (id,card_id,run_id,position,type,label,value,created_at),
  INSERT (card_id,run_id,position,type,label,value), UPDATE (type,label,value)
  ON public.card_outputs TO :"app_role";

-- Registros lifecycle, immutable version snapshots and transactional webhook outbox.
GRANT SELECT, INSERT (id,workspace_id,plugin_id,kind,title,state,payload,created_by,updated_by),
  UPDATE (title,payload,state,revision,updated_by,updated_at) ON public.extension_records TO :"app_role";
GRANT SELECT, INSERT (record_id,revision,title,state,payload,reason,actor_id)
  ON public.extension_record_versions TO :"app_role";
GRANT SELECT, INSERT (workspace_id,plugin_id,actor_id,operation_key,request_hash,response)
  ON public.extension_operations TO :"app_role";
GRANT SELECT ON public.extension_record_links TO :"app_role";
GRANT SELECT (id,workspace_id,endpoint,event_types,secret_ciphertext,active,created_at),
  INSERT (workspace_id,endpoint,event_types,secret_ciphertext,created_by),
  UPDATE (endpoint,event_types,active), DELETE
  ON public.webhook_subscriptions TO :"app_role";
GRANT SELECT (id,workspace_id,record_id,plugin_id,kind,state,revision,event_type,event_version,occurred_at),
  INSERT (workspace_id,record_id,plugin_id,kind,state,revision,event_type,event_version)
  ON public.webhook_events TO :"app_role";
GRANT SELECT (id,subscription_id,event_id,status,attempt_count,available_at,last_error,created_at,updated_at),
  INSERT (subscription_id,event_id), UPDATE (status,attempt_count,available_at,last_error,updated_at)
  ON public.webhook_deliveries TO :"app_role";

-- Invoker trigger present on the current DEV clone and exercised by card creation/update.
GRANT INSERT (board_id, card_id, kind, payload, chain) ON public.automation_events TO :"app_role";
GRANT USAGE ON SEQUENCE public.automation_events_id_seq TO :"app_role";
GRANT SELECT, UPDATE (organized_at) ON public.attachment_backup_cloud_copies TO :"app_role";

-- Pin ordinary schema and database access to named roles.
REVOKE USAGE ON SCHEMA public FROM PUBLIC;
REVOKE CONNECT ON DATABASE :"cutover_db" FROM PUBLIC;
RESET ROLE;
