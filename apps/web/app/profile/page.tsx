"use client";
import {useCreationAvailability} from '@/plugins/project-boards/use-creation-availability';
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { remember } from "@/lib/history";
import { GitProjectSettings } from "@/components/git-project-settings";
import { DeliveryProjectSettings } from "@/components/delivery-project-settings";
import {
  Activity as ActivityIcon,
  CheckSquare,
  Clock3,
  ChevronUp,
  Folder,
  FolderKanban,
  ImagePlus,
  Link2,
  Moon,
  Palette,
  UserRound,
} from "lucide-react";
import {
  api,
  send,
  Activity,
  AiProject,
  AiEffort,
  AiModel,
  Board,
  HomeCard,
  Preferences,
  User,
  cardUrl,
  clearSession,
  getToken,
  applyTheme,
  setUser,
} from "@/lib/api";
import {
  AppHeader,
  Avatar,
  CreateBoardModal,
  Modal,
  useConfirmModal,
  WorkspaceSidebar,
} from "@/components/ui";
import { useHydrated } from "@/lib/use-hydrated";
import { CalendarIntegrations } from "@/components/calendar-integrations";
import { AiEffortField, AiModelFields } from "@/components/ai-model-fields";

import {VaultConstantSelect} from '@/components/vault-constant-select';
import { AppBrand } from '@/components/branding';
import Image from 'next/image';

type EnvironmentSettings = { groups: Array<{ id:string; label:string; fields:Array<{key:string;label:string;secret:boolean;value:string;configured:boolean;vaultReference?:string}> }> };
type LoginHistoryItem = { id:string; logged_at:string; device_label:string };
type SecurityActivityItem = { id:string; label:string; created_at:string };
type PushConfig = { enabled: boolean; public_key: string | null; subscribed: boolean };
type Tab = "profile" | "activity" | "cards" | "projects" | "integrations" | "settings" | "branding";
const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "profile", label: "Perfil", icon: UserRound },
  { id: "activity", label: "Atividade", icon: ActivityIcon },
  { id: "cards", label: "Cartões atribuídos", icon: CheckSquare },
  { id: "projects", label: "Projetos", icon: FolderKanban },
  { id: "integrations", label: "Integrações", icon: Link2 },
  { id: "settings", label: "Configurações", icon: Palette },
  { id: "branding", label: "Identidade da aplicação", icon: ImagePlus },
];
export default function ProfilePage() {
  const {canCreateBoard,canCreateProject}=useCreationAvailability();
  const router = useRouter();
  const { confirm, confirmationModal } = useConfirmModal();
  const [user, setCurrentUser] = useState<User | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loginHistory, setLoginHistory] = useState<LoginHistoryItem[]>([]);
  const [securityActivity, setSecurityActivity] = useState<SecurityActivityItem[]>([]);
  const [cards, setCards] = useState<HomeCard[]>([]);
  const [projects, setProjects] = useState<AiProject[]>([]);
  const [models, setModels] = useState<AiModel[]>([]);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [projectInternalOrbit, setProjectInternalOrbit] = useState(false);
  const [editingProjectPath, setEditingProjectPath] = useState<string | null>(null);
  const [projectPathDraft, setProjectPathDraft] = useState("");
  const [savingProjectPath, setSavingProjectPath] = useState(false);
  const [directoryPicker, setDirectoryPicker] = useState<{path:string;parent:string|null;name:string;folders:Array<{name:string;path:string}>}|null>(null);
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);
  const [directoryPickerLoading, setDirectoryPickerLoading] = useState(false);
  const [directoryPickerError, setDirectoryPickerError] = useState("");
  const [savingProject, setSavingProject] = useState(false);
  const [environment, setEnvironment] = useState<EnvironmentSettings | null>(null);
  const [environmentDraft, setEnvironmentDraft] = useState<Record<string,string>>({});
  const [clearEnvironment, setClearEnvironment] = useState<string[]>([]);
  const [savingEnvironment, setSavingEnvironment] = useState(false);
  const [brandDraft,setBrandDraft]=useState<AppBrand>({app_name:'Orbit',icon_kind:'orbit',custom_icon_data:null,login_tagline:'Seu trabalho, com uma visão mais clara.',login_description:'Acompanhe o que vem pela frente, veja as novidades e organize seus projetos em quadros.',login_benefits:['Tarefas e prazos em destaque','Quadros, listas e cartões','Atividade e notificações em um lugar']});
  const [savingBrand,setSavingBrand]=useState(false);
  const ready = useHydrated();
  const [tab, setTab] = useState<Tab>("profile");
  const [name, setName] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [emailChangePassword, setEmailChangePassword] = useState("");
  const [emailChangeMessage, setEmailChangeMessage] = useState("");
  const [emailChangeError, setEmailChangeError] = useState("");
  const [emailChangeBusy, setEmailChangeBusy] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaPassword, setMfaPassword] = useState("");
  const [mfaChallengeId, setMfaChallengeId] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaMessage, setMfaMessage] = useState("");
  const [mfaError, setMfaError] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [create, setCreate] = useState(false);
  const load = useCallback(async () => {
    try {
      const [account, all, activity, logins, securityEvents, assigned, projectList, pluginCatalog, mfa] = await Promise.all([
          api<User>("/account"),
          api<Board[]>("/boards"),
          api<Activity[]>("/account/activity"),
          api<LoginHistoryItem[]>("/account/login-history"),
          api<SecurityActivityItem[]>("/account/security-activity"),
          api<HomeCard[]>("/account/cards"),
          api<AiProject[]>("/ai/projects"),
          api<{plugins:Array<{id:string;enabled:boolean}>}>("/plugins"),
          api<{enabled:boolean}>("/account/mfa"),
        ]);
      const pluginEnabled = pluginCatalog.plugins.some(plugin => plugin.id === "ai" && plugin.enabled);
      const availableModels = pluginEnabled ? await api<AiModel[]>("/ai/models") : [];
      setCurrentUser(account);
      setUser(account);
      setName(account.name);
      setEmailDraft(account.email);
      setBoards(all);
      setActivities(activity);
      setLoginHistory(logins);
      setSecurityActivity(securityEvents);
      setCards(assigned);
      setProjects(projectList);
      setModels(availableModels);
      setAiAvailable(pluginEnabled);
      setMfaEnabled(mfa.enabled);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  useEffect(() => {
    if (!getToken()) {
      router.push("/");
      return;
    }
    const requested = new URLSearchParams(window.location.search).get("tab");
    api<User>("/auth/me")
      .then(() => {
        if (tabs.some((item) => item.id === requested))
          setTab(requested as Tab);
        load();
      })
      .catch(() => {
        clearSession();
        router.push("/");
      });
  }, [load, router]);
  useEffect(() => {
    if (tab !== "integrations") return;
    api<EnvironmentSettings>("/settings/environment").then((settings) => {
      setEnvironment(settings);
      setEnvironmentDraft(Object.fromEntries(settings.groups.flatMap((group) => group.fields.map((field) => [field.key, field.vaultReference||field.value]))));
    }).catch((err) => setError((err as Error).message));
  }, [tab]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    api<PushConfig>("/notifications/push/config").then(async (config) => {
      if (!active) return;
      setPushEnabled(config.enabled && Boolean(config.public_key));
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setPushSubscribed(false);
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (active) setPushSubscribed(Boolean(subscription));
    }).catch(() => {
      if (active) { setPushEnabled(false); setPushSubscribed(false); }
    });
    return () => { active = false; };
  }, [user]);
  useEffect(()=>{if(tab!=='branding'||!user?.is_root)return;api<AppBrand>('/branding').then(setBrandDraft).catch(err=>setError((err as Error).message))},[tab,user?.is_root]);
  function changeTab(value: Tab) {
    setTab(value);
    window.history.replaceState(
      null,
      "",
      value === "profile" ? "/profile" : `/profile?tab=${value}`,
    );
    setError("");
    setNotice("");
  }
  async function updateProfile(body: Record<string, unknown>) {
    try {
      const account = await send<User>("/account", "PATCH", body);
      setCurrentUser(account);
      setUser(account);
      setName(account.name);
      setNotice("Perfil atualizado.");
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function requestEmailChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailChangeBusy(true);
    setEmailChangeError("");
    setEmailChangeMessage("");
    try {
      await send("/auth/email-change", "POST", { email: emailDraft, current_password: emailChangePassword });
      setEmailChangePassword("");
      setEmailChangeMessage("Enviamos um link de confirmação para o novo endereço. O e-mail da conta só muda depois da confirmação.");
    } catch (err) {
      setEmailChangeError((err as Error).message);
    } finally {
      setEmailChangeBusy(false);
    }
  }
  async function requestMfaChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMfaBusy(true); setMfaError(""); setMfaMessage("");
    try {
      const result = await send<{challenge_id:string;email_hint:string}>("/account/mfa/challenge","POST",{action:mfaEnabled?"disable":"enable",current_password:mfaPassword});
      setMfaPassword(""); setMfaChallengeId(result.challenge_id);
      setMfaMessage(`Enviamos um código de confirmação para ${result.email_hint}.`);
    } catch (err) { setMfaError((err as Error).message); }
    finally { setMfaBusy(false); }
  }
  async function confirmMfaChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMfaBusy(true); setMfaError("");
    try {
      const result=await send<{enabled:boolean}>("/account/mfa/confirm","POST",{challenge_id:mfaChallengeId,code:mfaCode});
      setMfaEnabled(result.enabled); setMfaChallengeId(""); setMfaCode("");
      setMfaMessage(result.enabled?"Verificação em duas etapas ativada. A cada login, enviaremos um código para seu e-mail.":"Verificação em duas etapas desativada.");
    } catch (err) { setMfaError((err as Error).message); }
    finally { setMfaBusy(false); }
  }
  async function uploadAvatar(file: File | null) {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 250000
    ) {
      setError("Escolha uma imagem PNG, JPEG ou WebP de até 250 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => updateProfile({ avatar_url: String(reader.result) });
    reader.readAsDataURL(file);
  }
  async function uploadBrandIcon(file:File|null){
    if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>250000){setError('Escolha uma imagem PNG, JPEG ou WebP de até 250 KB.');return;}
    const reader=new FileReader();reader.onload=()=>setBrandDraft(current=>({...current,icon_kind:'custom',custom_icon_data:String(reader.result)}));reader.readAsDataURL(file);
  }
  async function saveBrand(event:React.FormEvent){
    event.preventDefault();setSavingBrand(true);setError('');
    try{const saved=await send<AppBrand>('/branding','PATCH',brandDraft);setBrandDraft(saved);window.dispatchEvent(new Event('orbit:branding-updated'));setNotice('Identidade da aplicação atualizada em todos os pontos da interface.');}
    catch(err){setError((err as Error).message)}finally{setSavingBrand(false)}
  }
  async function preference(
    key: keyof Preferences,
    value: Preferences[keyof Preferences],
  ) {
    const previousTheme = user?.preferences?.theme || "light";
    if (key === "theme") applyTheme(value as "light" | "dark" | "terroso");
    try {
      const account = await send<User>("/account/preferences", "PATCH", {
        [key]: value,
      });
      setCurrentUser(account);
      setUser(account);
      setNotice("Preferências salvas.");
      setError("");
    } catch (err) {
      if (key === "theme") applyTheme(previousTheme);
      setError((err as Error).message);
    }
  }
  async function saveGlobalAi(body: { ai_default_model?: string | null; ai_default_effort?: AiEffort | null }) {
    try {
      const settings = await send<{ ai_default_model: string | null; ai_default_effort: AiEffort | null }>("/ai/settings", "PATCH", body);
      setCurrentUser((current) => current ? { ...current, ...settings } : current);
      if (user) setUser({ ...user, ...settings });
      setNotice("Configuração global de IA salva.");
      setError("");
    } catch (err) { setError((err as Error).message); }
  }
  async function saveProjectAi(projectId: string, body: { ai_default_model?: string | null; ai_default_effort?: AiEffort | null; is_internal_orbit?: boolean }) {
    try {
      const updated = await send<AiProject>(`/ai/projects/${projectId}`, "PATCH", body);
      setProjects((current) => current.map((project) => project.id === projectId ? updated : project));
      setNotice("Configuração do projeto salva.");
      setError("");
    } catch (err) { setError((err as Error).message); }
  }
  async function saveProjectPath(event: React.FormEvent, projectId: string) {
    event.preventDefault();
    setSavingProjectPath(true);
    setError("");
    try {
      const updated = await send<AiProject>(`/ai/projects/${projectId}`, "PATCH", { local_path: projectPathDraft.trim() });
      setProjects(current => current.map(project => project.id === projectId ? updated : project));
      setEditingProjectPath(null);
      setNotice("Caminho do projeto atualizado.");
    } catch (err) { setError((err as Error).message); }
    finally { setSavingProjectPath(false); }
  }
  async function browserNotifications() {
    if (!user?.preferences) return;
    if (user.preferences.browserNotifications)
      return preference("browserNotifications", false);
    if (typeof Notification === "undefined") {
      setError("Este navegador não oferece notificações externas.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted")
      await preference("browserNotifications", true);
    else setError("Permissão de notificações não concedida pelo navegador.");
  }
  function vapidKeyBytes(value: string): ArrayBuffer {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
    return bytes.buffer;
  }
  async function togglePushNotifications(enabled: boolean) {
    setPushBusy(true);
    setError("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined")
        throw new Error("Este navegador não oferece notificações push.");
      if (!window.isSecureContext) throw new Error("Notificações push exigem HTTPS ou localhost.");
      if (enabled) {
        const config = await api<PushConfig>("/notifications/push/config");
        if (!config.enabled || !config.public_key) throw new Error("O serviço push ainda não está configurado neste ambiente.");
        const registration = await navigator.serviceWorker.register("/push-worker.js", { scope: "/" });
        const existing = await registration.pushManager.getSubscription();
        const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
        if (permission !== "granted") throw new Error("Permissão de notificações não concedida pelo navegador.");
        const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(config.public_key) });
        await send("/notifications/push/subscription", "PUT", subscription.toJSON());
        setPushSubscribed(true);
        setNotice("Notificações push ativadas neste navegador.");
      } else {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const existing = await registration?.pushManager.getSubscription();
        if (existing) {
          await send("/notifications/push/subscription", "DELETE", { endpoint: existing.endpoint });
          await existing.unsubscribe();
        }
        setPushSubscribed(false);
        setNotice("Notificações push desativadas neste navegador.");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally { setPushBusy(false); }
  }
  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    setSavingProject(true);
    setError("");
    try {
      const payload = {
        name: projectName,
        local_path: projectPath,
        ...(user?.is_root ? {is_internal_orbit:projectInternalOrbit} : {}),
      };
      let project: AiProject;
      try {
        project = await send<AiProject>("/ai/projects", "POST", payload);
      } catch (err) {
        if ((err as Error & { code?:string }).code === "PROJECT_HOST_MOUNT_REQUIRED") {
          setError((err as Error).message);
          return;
        }
        if ((err as Error & { code?:string }).code !== "PROJECT_DIRECTORY_MISSING") throw err;
        confirm({ title: "Criar pasta do projeto", description: `${(err as Error).message}\n\nDeseja criar essa pasta no servidor do Orbit e cadastrar o projeto?`, confirmLabel: "Criar pasta", destructive: false }, async () => {
          const createdProject = await send<AiProject>("/ai/projects", "POST", { ...payload, create_directory:true });
          setProjects(current => [...current, createdProject].sort((a, b) => a.name.localeCompare(b.name)));
          setProjectName("");
          setProjectPath("");
          setProjectInternalOrbit(false);
          setNotice("Projeto adicionado.");
          setError("");
        });
        return;
      }
      setProjects(
        [...projects, project].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setProjectName("");
      setProjectPath("");
      setProjectInternalOrbit(false);
      setNotice("Projeto adicionado.");
      setError("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingProject(false);
    }
  }
  async function browseProjectDirectory(path?:string) {
    setDirectoryPickerLoading(true);
    setDirectoryPickerError("");
    try {
      const query=path?`?path=${encodeURIComponent(path)}`:"";
      setDirectoryPicker(await api<typeof directoryPicker>(`/ai/projects/directories${query}`));
    } catch(err) { setDirectoryPickerError((err as Error).message); }
    finally { setDirectoryPickerLoading(false); }
  }
  async function createProjectDirectory() {
    if (!directoryPicker) return;
    const name = window.prompt("Nome da nova pasta");
    if (!name?.trim()) return;
    setDirectoryPickerLoading(true);
    setDirectoryPickerError("");
    try {
      const created = await send<{ path:string }>("/ai/projects/directories", "POST", { path: directoryPicker.path, name: name.trim() });
      setProjectPath(created.path);
      await browseProjectDirectory(directoryPicker.path);
      setNotice("Pasta criada. Selecione-a para cadastrar o projeto.");
    } catch (err) { setDirectoryPickerError((err as Error).message); }
    finally { setDirectoryPickerLoading(false); }
  }
  async function saveEnvironment(event: React.FormEvent) {
    event.preventDefault();
    setSavingEnvironment(true);
    try {
      const values = Object.fromEntries(Object.entries(environmentDraft).filter(([key, value]) => value.length > 0&&!clearEnvironment.includes(key)));
      await send("/settings/environment", "PATCH", { values, clear: clearEnvironment });
      const settings = await api<EnvironmentSettings>("/settings/environment");
      setEnvironment(settings);
      setEnvironmentDraft(Object.fromEntries(settings.groups.flatMap((group) => group.fields.map((field) => [field.key, field.vaultReference||field.value]))));
      setClearEnvironment([]);
      setNotice("Configurações salvas. Reinicie a API para aplicar as alterações.");
      setError("");
    } catch (err) { setError((err as Error).message); }
    finally { setSavingEnvironment(false); }
  }
  function removeProject(id: string) {
    confirm(
      { title: "Remover projeto", description: "Remover este projeto? Os cartões passarão a usar o projeto padrão do quadro, quando configurado.", confirmLabel: "Remover" },
      async () => { await send(`/ai/projects/${id}`, "DELETE"); setProjects((current) => current.filter((project) => project.id !== id)); setNotice("Projeto removido."); },
    );
  }
  async function createBoard(
    title: string,
    background: string,
    workspaceId?: string,
  ) {
    const board = await send<Board>("/boards", "POST", {
      title,
      background,
      workspace_id: workspaceId,
    });
    remember({label:'criar quadro',undo:[{path:`/boards/${board.id}/close`,method:'PATCH'}],redo:[{path:`/boards/${board.id}/reopen`,method:'PATCH'}]});
    router.push(`/board/${board.id}`);
  }
  if (!ready) return <main className="min-h-screen bg-[#f7f8fa]"><p role="status" aria-live="polite" className="sr-only">Carregando perfil…</p></main>;
  if (!user) return <main className="min-h-screen bg-[#f7f8fa]"><p role="status" aria-live="polite" className="sr-only">Redirecionando para a entrada…</p></main>;
  const preferences = user.preferences || {
    theme: "light",
    notifications: true,
    browserNotifications: false,
    emailNotifications: false,
    shortcuts: true,
    compactCards: false,
  };
  return (
    <div className="flex min-h-screen flex-col bg-[#f7f8fa]">
      <AppHeader user={user} boards={boards} onCreate={() => setCreate(true)} />
      <div className="flex min-h-0 flex-1">
        <WorkspaceSidebar
          boards={boards}
          onCreate={() => setCreate(true)}
          onChoose={(id) => router.push(id ? `/board/${id}` : "/boards")}
        />
        <main className="min-w-0 flex-1 px-4 py-8 sm:px-8">
          <div className="mb-7 flex flex-wrap items-center gap-4">
            <Avatar name={user.name} url={user.avatar_url} size="lg" />
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#626f86]">
                SUA CONTA
              </p>
              <h1 className="text-[27px] font-bold">{user.name}</h1>
              <p className="text-sm text-[#626f86]">{user.email}</p>
            </div>
          </div>
          <div className="mb-6 flex gap-1 overflow-x-auto border-b border-[#dfe1e6]">
            {tabs.filter(item=>item.id!=='branding'||user.is_root).map((item) => (
              <button
                key={item.id}
                onClick={() => changeTab(item.id)}
                className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold ${tab === item.id ? "border-[#0c66e4] text-[#0c66e4]" : "border-transparent text-[#626f86] hover:text-[#172b4d]"}`}
              >
                <item.icon size={16} />
                {item.label}
              </button>
            ))}
          </div>
          {error && (
            <p
              role="alert"
              className="mb-4 rounded bg-[#ffebe6] p-3 text-sm text-[#ae2a19]"
            >
              {error}
            </p>
          )}
          {notice && (
            <p
              role="status"
              className="mb-4 rounded bg-[#e3fcef] p-3 text-sm text-[#216e4e]"
            >
              {notice}
            </p>
          )}
          {tab === "profile" && (
            <div className="grid gap-6 md:grid-cols-[minmax(0,1.4fr)_minmax(260px,1fr)]">
              <section className="rounded-xl border border-[#dfe1e6] bg-white p-6 shadow-sm">
                <h2 className="mb-5 text-lg font-bold">
                  Informações do perfil
                </h2>
                <div className="mb-5 flex flex-wrap items-center gap-4">
                  <Avatar name={user.name} url={user.avatar_url} size="lg" />
                  <div>
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded bg-[#e9eaed] px-3 py-2 text-sm font-semibold hover:bg-[#dfe1e6]">
                      <ImagePlus size={16} /> Alterar avatar
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) =>
                          uploadAvatar(e.target.files?.[0] || null)
                        }
                        className="sr-only"
                      />
                    </label>
                    {user.avatar_url && (
                      <button
                        onClick={() => updateProfile({ avatar_url: null })}
                        className="ml-2 text-xs text-[#626f86] underline"
                      >
                        Remover
                      </button>
                    )}
                    <p className="mt-1 text-xs text-[#626f86]">
                      PNG, JPEG ou WebP até 250 KB.
                    </p>
                  </div>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    updateProfile({ name });
                  }}
                >
                  <label
                    htmlFor="profile-name"
                    className="mb-1 block text-xs font-bold"
                  >
                    Nome exibido
                  </label>
                  <input
                    id="profile-name"
                    required
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mb-4 w-full rounded border border-[#8590a2] px-3 py-2 text-sm"
                  />
                  <button
                    disabled={!name.trim() || name === user.name}
                    className="rounded bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white"
                  >
                    Salvar alterações
                  </button>
                </form>
              </section>
              <section className="rounded-xl border border-[#dfe1e6] bg-white p-6 shadow-sm">
                <h2 className="text-lg font-bold">Alterar e-mail da conta</h2>
                <p className="mt-1 text-sm text-[#626f86]">Confirme a alteração pelo link enviado ao novo endereço. Sua senha atual será solicitada antes do envio.</p>
                <form onSubmit={requestEmailChange} className="mt-4 grid max-w-lg gap-3">
                  <label className="text-xs font-bold">Novo e-mail<input required type="email" maxLength={320} autoComplete="email" value={emailDraft} onChange={(event) => setEmailDraft(event.target.value)} className="mt-1 min-h-10 w-full rounded border border-[#8590a2] px-3 text-sm font-normal" /></label>
                  <label className="text-xs font-bold">Senha atual<input required type="password" maxLength={200} autoComplete="current-password" value={emailChangePassword} onChange={(event) => setEmailChangePassword(event.target.value)} className="mt-1 min-h-10 w-full rounded border border-[#8590a2] px-3 text-sm font-normal" /></label>
                  {emailChangeError && <p role="alert" className="text-sm text-[#ae2a19]">{emailChangeError}</p>}
                  {emailChangeMessage && <p role="status" className="text-sm text-[#216e4e]">{emailChangeMessage}</p>}
                  <button disabled={emailChangeBusy || !emailDraft.trim() || emailDraft.trim().toLowerCase() === user.email.toLowerCase() || !emailChangePassword} className="min-h-10 justify-self-start rounded bg-[#0c66e4] px-4 text-sm font-semibold text-white disabled:opacity-60">{emailChangeBusy ? "Enviando…" : "Enviar confirmação"}</button>
                </form>
              </section>
              <section className="rounded-xl border border-[#dfe1e6] bg-white p-6 shadow-sm">
                <h2 className="text-lg font-bold">Verificação em duas etapas</h2>
                <p className="mt-1 text-sm text-[#626f86]">{mfaEnabled?"No login, um código de uso único será enviado ao e-mail verificado da conta.":"Adicione uma confirmação por e-mail depois da senha. Confirme seu endereço antes de ativar."}</p>
                {mfaMessage&&<p role="status" className="mt-3 text-sm text-[#216e4e]">{mfaMessage}</p>}{mfaError&&<p role="alert" className="mt-3 text-sm text-[#ae2a19]">{mfaError}</p>}
                {mfaChallengeId?<form onSubmit={confirmMfaChange} className="mt-4 grid max-w-lg gap-3"><label className="text-xs font-bold">Código de seis dígitos<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={mfaCode} onChange={event=>setMfaCode(event.target.value.replace(/\D/g,"").slice(0,6))} className="mt-1 min-h-10 w-full rounded border border-[#8590a2] px-3 text-sm font-normal tracking-[.3em]" /></label><div className="flex flex-wrap gap-2"><button disabled={mfaBusy||mfaCode.length!==6} className="min-h-10 rounded bg-[#0c66e4] px-4 text-sm font-semibold text-white disabled:opacity-60">{mfaBusy?"Aguarde…":"Confirmar código"}</button><button type="button" disabled={mfaBusy} onClick={()=>{setMfaChallengeId("");setMfaCode("");setMfaMessage("");}} className="min-h-10 rounded border border-[#dfe1e6] px-4 text-sm">Cancelar</button></div></form>:<form onSubmit={requestMfaChange} className="mt-4 grid max-w-lg gap-3"><label className="text-xs font-bold">Senha atual<input required type="password" maxLength={200} autoComplete="current-password" value={mfaPassword} onChange={event=>setMfaPassword(event.target.value)} className="mt-1 min-h-10 w-full rounded border border-[#8590a2] px-3 text-sm font-normal" /></label><button disabled={mfaBusy||!mfaPassword} className="min-h-10 justify-self-start rounded bg-[#0c66e4] px-4 text-sm font-semibold text-white disabled:opacity-60">{mfaBusy?"Enviando…":mfaEnabled?"Desativar verificação em duas etapas":"Ativar verificação em duas etapas"}</button></form>}
              </section>
              <section className="rounded-xl border border-[#dfe1e6] bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-lg font-bold">Seu trabalho</h2>
                <div className="space-y-3">
                  <div className="flex justify-between rounded bg-[#f1f2f4] p-3 text-sm">
                    <span>Quadros acessíveis</span>
                    <strong>{boards.length}</strong>
                  </div>
                  <div className="flex justify-between rounded bg-[#f1f2f4] p-3 text-sm">
                    <span>Cartões atribuídos</span>
                    <strong>{cards.length}</strong>
                  </div>
                  <div className="flex justify-between rounded bg-[#f1f2f4] p-3 text-sm">
                    <span>Atividades recentes</span>
                    <strong>{activities.length}</strong>
                  </div>
                </div>
                <button
                  onClick={() => changeTab("activity")}
                  className="mt-5 text-sm font-semibold text-[#0c66e4] hover:underline"
                >
                  Ver atividade →
                </button>
              </section>
            </div>
          )}
          {tab === "activity" && (
            <section className="overflow-hidden rounded-xl border border-[#dfe1e6] bg-white shadow-sm">
              <div className="border-b border-[#dfe1e6] px-5 py-4">
                <h2 className="text-lg font-bold">Atividade recente</h2>
                <p className="text-xs text-[#626f86]">
                  Alterações e conversas nos seus quadros
                </p>
              </div>
              {activities.length === 0 ? (
                <p className="p-8 text-center text-sm text-[#626f86]">
                  Suas atividades aparecerão aqui.
                </p>
              ) : (
                <div className="divide-y divide-[#f1f2f4]">
                  {activities.map((item) => (
                    <button
                      key={item.id}
                      onClick={() =>
                        item.board_id &&
                        router.push(cardUrl(item.board_id, item.card_id, item.card_url_token))
                      }
                      className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-[#f7f8fa]"
                    >
                      <span className="mt-1 rounded-full bg-[#e9e5fa] p-2 text-[#6554c0]">
                        <ActivityIcon size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm">
                          <strong>{item.actor_name}</strong> {item.body}
                        </span>
                        <span className="mt-1 block truncate text-xs text-[#626f86]">
                          {item.board_title}
                          {item.card_title
                            ? ` · ${item.card_title}`
                            : ""} ·{" "}
                          {new Date(item.created_at).toLocaleString("pt-BR")}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="border-t border-[#dfe1e6] px-5 py-4">
                <h2 className="text-lg font-bold">Acessos recentes</h2>
                <p className="mt-1 text-xs text-[#626f86]">Entradas confirmadas na sua conta nos últimos 180 dias. O Orbit guarda apenas o tipo de navegador e dispositivo, sem armazenar o endereço IP.</p>
                {loginHistory.length === 0 ? <p className="mt-4 text-sm text-[#626f86]">Os próximos acessos aparecerão aqui.</p> : <ul className="mt-3 divide-y divide-[#f1f2f4]">{loginHistory.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><span className="font-medium">{item.device_label}</span><time dateTime={item.logged_at} className="text-xs text-[#626f86]">{new Date(item.logged_at).toLocaleString("pt-BR")}</time></li>)}</ul>}
              </div>
              <div className="border-t border-[#dfe1e6] px-5 py-4">
                <h2 className="text-lg font-bold">Atividades relevantes da conta</h2>
                <p className="mt-1 text-xs text-[#626f86]">Alterações de perfil, senha, e-mail, verificação em duas etapas e login social nos últimos 180 dias.</p>
                {securityActivity.length===0?<p className="mt-4 text-sm text-[#626f86]">As alterações relevantes da conta aparecerão aqui.</p>:<ul className="mt-3 divide-y divide-[#f1f2f4]">{securityActivity.map(item=><li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><span className="font-medium">{item.label}</span><time dateTime={item.created_at} className="text-xs text-[#626f86]">{new Date(item.created_at).toLocaleString("pt-BR")}</time></li>)}</ul>}
              </div>
            </section>
          )}
          {tab === "cards" && (
            <section className="overflow-hidden rounded-xl border border-[#dfe1e6] bg-white shadow-sm">
              <div className="border-b border-[#dfe1e6] px-5 py-4">
                <h2 className="text-lg font-bold">Cartões atribuídos a você</h2>
                <p className="text-xs text-[#626f86]">
                  Todos os seus cartões, reunidos aqui
                </p>
              </div>
              {cards.length === 0 ? (
                <p className="p-8 text-center text-sm text-[#626f86]">
                  Atribua-se a um cartão para acompanhá-lo nesta lista.
                </p>
              ) : (
                <div className="divide-y divide-[#f1f2f4]">
                  {cards.map((card) => (
                    <button
                      key={card.id}
                      onClick={() =>
                        router.push(cardUrl(card.board_id, card.id, card.url_token))
                      }
                      className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-[#f7f8fa]"
                    >
                      <span className="h-9 w-1 rounded bg-[#0c66e4]" />
                      <span className="min-w-0 flex-1">
                        <strong
                          className="block truncate text-sm"
                        >
                          {card.title}
                        </strong>
                        <span className="mt-1 block truncate text-xs text-[#626f86]">
                          {card.board_title} · {card.list_title}
                        </span>
                      </span>
                      {card.due_date && (
                        <span className="shrink-0 rounded bg-[#fff1b8] px-2 py-1 text-xs text-[#7f5f01]">
                          <Clock3 size={12} className="mr-1 inline" />
                          {new Date(card.due_date).toLocaleDateString("pt-BR")}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
          {tab === "projects" && (
            <div className="grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(320px,1fr)]">
              <section className="overflow-hidden rounded-xl border border-[#dfe1e6] bg-white shadow-sm">
                <div className="border-b border-[#dfe1e6] px-5 py-4">
                  <h2 className="text-lg font-bold">Projetos locais</h2>
                  <p className="text-xs text-[#626f86]">
                    A execução de uma sessão de prompt fica limitada à pasta
                    selecionada.
                  </p>
                </div>
                {projects.length === 0 ? (
                  <p className="p-6 text-sm text-[#626f86]">
                    Nenhum projeto cadastrado.
                  </p>
                ) : (
                  <div className="divide-y divide-[#f1f2f4]">
                    {projects.map((project) => (
                      <div
                        key={project.id}
                        className="flex items-center gap-3 px-5 py-4"
                      >
                        <FolderKanban size={18} className="text-[#6554c0]" />
                        <div className="min-w-0 flex-1">
                          <strong className="block text-sm">
                            {project.name}
                          </strong>
                          {project.is_internal_orbit && (
                            <span className="text-xs font-semibold text-[#6554c0]">
                              Orbit interno
                            </span>
                          )}
                          <code className="block truncate text-xs text-[#626f86]">
                            {project.local_path}
                          </code>
                          {editingProjectPath === project.id ? (
                            <form onSubmit={event => void saveProjectPath(event, project.id)} className="mt-2 flex flex-wrap items-center gap-2">
                              <input autoFocus aria-label={`Novo caminho de ${project.name}`} value={projectPathDraft} onChange={event => setProjectPathDraft(event.target.value)} className="min-w-64 flex-1 rounded border border-[#8590a2] bg-white px-2 py-1 text-sm" required />
                              <button type="button" disabled={savingProjectPath} onClick={() => { setDirectoryPickerOpen(true); void browseProjectDirectory(projectPathDraft || undefined); }} className="rounded border border-[#c1c7d0] px-2.5 py-1 text-xs font-semibold">Navegar</button>
                              <button type="submit" disabled={savingProjectPath} className="rounded bg-[#0c66e4] px-2.5 py-1 text-xs font-semibold text-white">Salvar caminho</button>
                              <button type="button" disabled={savingProjectPath} onClick={() => setEditingProjectPath(null)} className="rounded px-2 py-1 text-xs hover:bg-[#e9eaed]">Cancelar</button>
                            </form>
                          ) : (
                            <button type="button" onClick={() => { setEditingProjectPath(project.id); setProjectPathDraft(project.local_path); setError(""); }} className="mt-1 text-xs font-semibold text-[#0c66e4] hover:underline">Alterar caminho</button>
                          )}
                          {aiAvailable && <details className="mt-3 max-w-2xl rounded-lg border border-[#dfe1e6] p-3">
                            <summary className="cursor-pointer text-xs font-semibold">Configuração de IA do projeto</summary>
                            <div className="mt-3 space-y-3">
                              <AiModelFields value={project.ai_default_model} inheritedValue={user?.ai_default_model} models={models} onSave={(value) => saveProjectAi(project.id, { ai_default_model: value })} />
                              <AiEffortField value={project.ai_default_effort} inheritedValue={user?.ai_default_effort} onChange={(value) => saveProjectAi(project.id, { ai_default_effort: value })} />
                            </div>
                          </details>}
                          {user?.is_root && <label className="mt-3 flex items-start gap-2 text-xs font-semibold"><input type="checkbox" checked={Boolean(project.is_internal_orbit)} onChange={event=>void saveProjectAi(project.id,{is_internal_orbit:event.target.checked})} className="mt-0.5"/><span>Este projeto é uma instância interna do Orbit<span className="mt-0.5 block font-normal text-[#626f86]">Use para vincular quadros de desenvolvimento a outra instalação do Orbit.</span></span></label>}
                          <GitProjectSettings projectId={project.id} isInternalOrbit={project.is_internal_orbit} />
                          <DeliveryProjectSettings projectId={project.id} />
                        </div>
                        <button onClick={() => void removeProject(project.id)} className="text-xs text-[#ae2a19]">Remover</button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
{canCreateProject&&              <form
                onSubmit={createProject}
                className="h-fit rounded-xl border border-[#dfe1e6] bg-white p-6 shadow-sm"
              >
                <h2 className="mb-4 text-lg font-bold">Adicionar projeto</h2>
                <label className="mb-3 block text-sm font-semibold">
                  Nome
                  <input
                    required
                    maxLength={120}
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    className="mt-1 w-full rounded border border-[#8590a2] px-3 py-2 text-sm font-normal"
                    placeholder="Meu projeto"
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Pasta local
                  <input
                    required
                    value={projectPath}
                    onChange={(event) => setProjectPath(event.target.value)}
                    className="mt-1 w-full rounded border border-[#8590a2] px-3 py-2 text-sm font-normal"
                    placeholder="/home/meada/projetos/exemplo"
                  />
                </label>
                {user?.is_root&&<label className="mt-3 flex items-start gap-2 text-xs font-semibold"><input type="checkbox" checked={projectInternalOrbit} onChange={event=>setProjectInternalOrbit(event.target.checked)} className="mt-0.5"/><span>Este projeto é uma instância interna do Orbit<span className="mt-0.5 block font-normal text-[#626f86]">Classifique repositórios de outras instalações do Orbit para usá-los como referência arquitetural.</span></span></label>}
                <button type="button" onClick={() => { setDirectoryPickerOpen(true); void browseProjectDirectory(); }} className="mt-2 rounded border border-[#c1c7d0] px-3 py-2 text-xs font-semibold text-[#344563] hover:bg-[#f7f8fa]">Navegar pelas pastas</button>
                    <p className="mt-2 text-xs text-[#626f86]">Informe ou selecione um caminho absoluto acessível pela API do Orbit. Em instalações Docker, pastas do host precisam estar montadas no contêiner.</p>
                <button disabled={savingProject || !projectName.trim() || !projectPath.trim()} className="mt-4 rounded bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {savingProject ? "Salvando..." : "Adicionar"}
                </button>
              </form>}
              {directoryPickerOpen && (
                <Modal onClose={() => setDirectoryPickerOpen(false)} title="Selecionar pasta do projeto" wide>
                  <div className="flex max-h-[min(80vh,640px)] w-full flex-col">
                    <header className="border-b border-[#dfe1e6] px-5 py-4"><h2 className="text-lg font-bold">Selecionar pasta do projeto</h2><p className="mt-1 break-all text-xs text-[#626f86]">{directoryPicker?.path || "Carregando caminho…"}</p></header>
                    {directoryPicker?.parent && <button type="button" disabled={directoryPickerLoading} onClick={()=>void browseProjectDirectory(directoryPicker.parent!)} className="flex items-center gap-2 border-b border-[#f1f2f4] px-5 py-3 text-left text-sm font-semibold text-[#344563] hover:bg-[#f7f8fa]"><ChevronUp size={16}/> Pasta anterior</button>}
                    {directoryPickerError && <p role="alert" className="px-5 py-3 text-sm text-[#ae2a19]">{directoryPickerError}</p>}
                    <div className="min-h-0 flex-1 overflow-y-auto">
                      {directoryPickerLoading ? <p className="p-5 text-sm text-[#626f86]">Carregando pastas…</p> : directoryPicker?.folders.length ? directoryPicker.folders.map(folder=><button key={folder.path} type="button" onClick={()=>void browseProjectDirectory(folder.path)} className="flex w-full items-center gap-3 border-b border-[#f1f2f4] px-5 py-3 text-left text-sm hover:bg-[#f7f8fa]"><Folder size={17} className="shrink-0 text-[#6554c0]"/><span className="truncate">{folder.name}</span></button>) : !directoryPickerError && <p className="p-5 text-sm text-[#626f86]">Nenhuma subpasta acessível.</p>}
                    </div>
                    <footer className="flex flex-wrap justify-end gap-2 border-t border-[#dfe1e6] p-4"><button type="button" disabled={!directoryPicker || directoryPickerLoading} onClick={()=>void createProjectDirectory()} className="mr-auto rounded border border-[#c1c7d0] px-4 py-2 text-sm font-semibold text-[#344563] disabled:opacity-50">Criar nova pasta</button><button type="button" onClick={()=>setDirectoryPickerOpen(false)} className="rounded border border-[#c1c7d0] px-4 py-2 text-sm font-semibold">Cancelar</button><button type="button" disabled={!directoryPicker || directoryPickerLoading} onClick={()=>{if(directoryPicker){if(editingProjectPath)setProjectPathDraft(directoryPicker.path);else setProjectPath(directoryPicker.path);}setDirectoryPickerOpen(false);}} className="rounded bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Selecionar esta pasta</button></footer>
                  </div>
                </Modal>
              )}
            </div>
          )}
          {tab === "integrations" && (
            <div className="space-y-6">
            <CalendarIntegrations providerId="orbit_cards" />
            <form onSubmit={saveEnvironment} className="max-w-4xl rounded-xl border border-[#dfe1e6] bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold">Configurações do core</h2>
              <p className="mt-1 text-sm leading-6 text-[#626f86]">Credenciais compartilhadas e configurações da aplicação ficam aqui. Variáveis específicas de serviços ficam no botão Configurar de cada plugin. Campos vazios mantêm o valor atual; use “Remover” para apagar uma configuração.</p>
              <div className="mt-5 space-y-5">
                {environment?.groups.map((group) => (
                  <section key={group.id} className="rounded-lg border border-[#dfe1e6] p-4">
                    <h3 className="mb-3 text-sm font-bold">{group.label}</h3>
                    <div className="grid gap-3 md:grid-cols-2">
                      {group.fields.map((field) => (
                        <label key={field.key} className="min-w-0 text-xs font-semibold text-[#344563]">
                          {field.label}
                          {field.secret ? (
                            <textarea
                              autoComplete="off"
                              spellCheck={false}
                              rows={Math.min(5, Math.max(2, (environmentDraft[field.key] || "").split("\n").length))}
                              disabled={environmentDraft[field.key]?.startsWith("orbit-vault://")} value={environmentDraft[field.key]?.startsWith("orbit-vault://")?"":environmentDraft[field.key] || ""}
                              onChange={(event) => { setEnvironmentDraft((current) => ({ ...current, [field.key]:event.target.value })); if (event.target.value) setClearEnvironment((current) => current.filter((key) => key !== field.key)); }}
                              placeholder={field.configured ? "Configurado; deixe vazio para manter" : "Não configurado"}
                              className="mt-1 w-full resize-y rounded border border-[#c1c7d0] px-3 py-2 text-sm font-normal text-[#172b4d]"
                            />
                          ) : (
                            <input
                              type="text"
                              autoComplete="off"
                              spellCheck={false}
                              disabled={environmentDraft[field.key]?.startsWith("orbit-vault://")} value={environmentDraft[field.key]?.startsWith("orbit-vault://")?"":environmentDraft[field.key] || ""}
                              onChange={(event) => { setEnvironmentDraft((current) => ({ ...current, [field.key]:event.target.value })); if (event.target.value) setClearEnvironment((current) => current.filter((key) => key !== field.key)); }}
                              placeholder="Não configurado"
                              className="mt-1 w-full rounded border border-[#c1c7d0] px-3 py-2 text-sm font-normal text-[#172b4d]"
                            />
                          )}
                          {["google","microsoft","email"].includes(group.id)&&<VaultConstantSelect label={`Constante para ${field.label}`} value={environmentDraft[field.key]||""} onChange={value=>{setEnvironmentDraft(current=>({...current,[field.key]:value}));setClearEnvironment(current=>!value&&environmentDraft[field.key]?.startsWith("orbit-vault://")?[...new Set([...current,field.key])]:current.filter(key=>key!==field.key))}}/>}
                          <span className="mt-1 flex items-center justify-between gap-2 font-normal text-[#626f86]"><code>{field.key}</code>{field.configured && <button type="button" className="text-[#ae2a19] hover:underline" onClick={() => { setClearEnvironment((current) => current.includes(field.key) ? current.filter((key) => key !== field.key) : [...current, field.key]); setEnvironmentDraft((current) => ({ ...current, [field.key]:"" })); }}>{clearEnvironment.includes(field.key) ? "Cancelar remoção" : "Remover"}</button>}</span>
                        </label>
                      ))}
                    </div>
                  </section>
                )) || <p className="text-sm text-[#626f86]">Carregando configurações…</p>}
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button disabled={savingEnvironment || !environment} className="rounded bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{savingEnvironment ? "Salvando…" : "Salvar configurações"}</button>
                <span className="text-xs text-[#626f86]">As alterações exigem reinicialização da API. NEXT_PUBLIC_API_URL também exige rebuild da aplicação web.</span>
              </div>
            </form>
            </div>
          )}
          {tab === "branding" && user.is_root && (
            <section className="max-w-3xl rounded-xl border border-[#dfe1e6] bg-white p-5 shadow-sm sm:p-7">
              <div className="mb-6 flex items-center gap-4">
                {brandDraft.icon_kind==='custom'&&brandDraft.custom_icon_data?<Image src={brandDraft.custom_icon_data} width={56} height={56} unoptimized alt="Prévia do ícone" className="h-14 w-14 rounded-xl border border-[#dfe1e1] object-contain"/>:<Image src={brandDraft.icon_kind==='tree_of_life'?'/brand-tree-of-life.svg':'/brand-orbit.svg'} width={56} height={56} alt="Prévia do ícone" className="h-14 w-14 rounded-xl border border-[#dfe1e1] object-contain"/>}
                <div><h2 className="text-lg font-bold">Identidade desta instância</h2><p className="text-sm text-[#626f86]">Nome, título do navegador e ícone são salvos separadamente em cada banco de dados.</p></div>
              </div>
              <form onSubmit={saveBrand} className="space-y-5">
                <label className="block text-sm font-semibold">Nome da aplicação<input required maxLength={80} value={brandDraft.app_name} onChange={event=>setBrandDraft(current=>({...current,app_name:event.target.value}))} className="mt-1 min-h-11 w-full rounded border border-[#8590a2] px-3 py-2 font-normal" placeholder="Ex.: Orbit Dev"/></label>
                <div className="space-y-4 rounded-lg border border-[#dfe1e6] bg-[#f7f8fa] p-4">
                  <div><h3 className="text-sm font-bold">Apresentação da tela de login</h3><p className="mt-1 text-xs text-[#626f86]">Este conteúdo aparece ao lado do formulário em telas maiores.</p></div>
                  <label className="block text-sm font-semibold">Título<textarea required maxLength={180} rows={2} value={brandDraft.login_tagline} onChange={event=>setBrandDraft(current=>({...current,login_tagline:event.target.value}))} className="mt-1 w-full rounded border border-[#8590a2] bg-white px-3 py-2 font-normal"/></label>
                  <label className="block text-sm font-semibold">Descrição<textarea required maxLength={500} rows={3} value={brandDraft.login_description} onChange={event=>setBrandDraft(current=>({...current,login_description:event.target.value}))} className="mt-1 w-full rounded border border-[#8590a2] bg-white px-3 py-2 font-normal"/></label>
                  <fieldset><legend className="mb-2 text-sm font-semibold">Destaques</legend><div className="space-y-2">{brandDraft.login_benefits.map((item,index)=><div key={index} className="flex gap-2"><input required maxLength={120} aria-label={`Destaque ${index+1}`} value={item} onChange={event=>setBrandDraft(current=>({...current,login_benefits:current.login_benefits.map((benefit,i)=>i===index?event.target.value:benefit)}))} className="min-h-11 min-w-0 flex-1 rounded border border-[#8590a2] bg-white px-3 py-2 text-sm font-normal"/><button type="button" disabled={brandDraft.login_benefits.length<=1} onClick={()=>setBrandDraft(current=>({...current,login_benefits:current.login_benefits.filter((_,i)=>i!==index)}))} className="min-h-11 rounded border border-[#dfe1e6] px-3 text-sm text-[#ae2a19] disabled:opacity-40" aria-label={`Remover destaque ${index+1}`}>Remover</button></div>)}</div><button type="button" disabled={brandDraft.login_benefits.length>=5} onClick={()=>setBrandDraft(current=>({...current,login_benefits:[...current.login_benefits,'']}))} className="mt-2 min-h-10 rounded border border-[#c1c7d0] px-3 text-sm font-semibold disabled:opacity-40">Adicionar destaque</button></fieldset>
                </div>
                <fieldset><legend className="mb-2 text-sm font-semibold">Marca do ícone</legend><div className="grid gap-2 sm:grid-cols-3">
                  <button type="button" aria-pressed={brandDraft.icon_kind==='orbit'} onClick={()=>setBrandDraft(current=>({...current,icon_kind:'orbit',custom_icon_data:null}))} className={`min-h-12 rounded-lg border px-3 text-sm font-semibold ${brandDraft.icon_kind==='orbit'?'border-[#0c66e4] bg-[#e9f2ff] text-[#0c66e4]':'border-[#dfe1e6]'}`}>Marca Orbit atual</button>
                  <button type="button" aria-pressed={brandDraft.icon_kind==='tree_of_life'} onClick={()=>setBrandDraft(current=>({...current,icon_kind:'tree_of_life',custom_icon_data:null}))} className={`min-h-12 rounded-lg border px-3 text-sm font-semibold ${brandDraft.icon_kind==='tree_of_life'?'border-[#0c66e4] bg-[#e9f2ff] text-[#0c66e4]':'border-[#dfe1e6]'}`}>Árvore da vida</button>
                  <label className={`flex min-h-12 cursor-pointer items-center justify-center rounded-lg border px-3 text-center text-sm font-semibold ${brandDraft.icon_kind==='custom'?'border-[#0c66e4] bg-[#e9f2ff] text-[#0c66e4]':'border-[#dfe1e6]'}`}>Enviar ícone<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={event=>{void uploadBrandIcon(event.target.files?.[0]||null);event.currentTarget.value=''}}/></label>
                </div><p className="mt-2 text-xs text-[#626f86]">Ícone enviado: PNG, JPEG ou WebP, até 250 KB. A árvore da vida usa tons de vinho, terra e oliva.</p></fieldset>
                <div className="flex flex-wrap items-center gap-3 border-t border-[#dfe1e6] pt-4"><button disabled={savingBrand||!brandDraft.app_name.trim()||(brandDraft.icon_kind==='custom'&&!brandDraft.custom_icon_data)} className="min-h-11 rounded bg-[#0c66e4] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{savingBrand?'Salvando…':'Salvar identidade'}</button><span className="text-xs text-[#626f86]">A alteração aparece imediatamente nesta instância.</span></div>
              </form>
            </section>
          )}
          {tab === "settings" && (
            <div className="grid gap-6 md:grid-cols-2">
              {aiAvailable && <section className="rounded-xl border border-[#c3b6f7] bg-[#f7f5ff] p-6 shadow-sm">
                <h2 className="mb-1 text-lg font-bold text-[#403294]">IA global</h2>
                <p className="mb-5 text-sm text-[#626f86]">Base de modelo e esforço para projetos, quadros e cartões sem configuração própria. Sem escolha, o campo continua vazio.</p>
                <div className="space-y-4">
                  <AiModelFields value={user?.ai_default_model} models={models} onSave={(value) => saveGlobalAi({ ai_default_model: value })} />
                  <AiEffortField value={user?.ai_default_effort} onChange={(value) => saveGlobalAi({ ai_default_effort: value })} />
                </div>
              </section>}
              <section className="rounded-xl border border-[#dfe1e6] bg-white p-6 shadow-sm">
                <h2 className="mb-1 text-lg font-bold">Aparência</h2>
                <p className="mb-5 text-sm text-[#626f86]">
                  Escolha o tema da interface. A alteração é aplicada imediatamente e salva na sua conta.
                </p>
                <p className="theme-forced-notice mb-5 hidden rounded-lg bg-[#f4e6d4] p-3 text-sm text-[#633b2d]">O tema desta instância é definido pela organização.</p>
                <div aria-label="Tema da interface" className="theme-preference-options grid grid-cols-1 gap-3 sm:grid-cols-3" role="group">
                  {(["light", "dark", "terroso"] as const).map((theme) => (
                    <button
                      type="button"
                      key={theme}
                      onClick={() => preference("theme", theme)}
                      aria-pressed={preferences.theme === theme}
                      className={`profile-theme-option flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border-2 p-4 text-sm font-semibold text-[#172b4d] transition-colors ${preferences.theme === theme ? "border-[#6554c0] bg-[#e9e5fa] ring-2 ring-[#6554c0]/30" : "border-[#dfe1e6] hover:border-[#8590a2]"}`}
                    >
                      {theme === "light" ? <Palette size={25} /> : theme === "dark" ? <Moon size={25} /> : <span aria-hidden="true" className="h-6 w-6 rounded-full border border-[#7d3624] bg-[linear-gradient(135deg,#a80d4b_0_40%,#d2672b_40%_70%,#54603a_70%)]" />}{" "}
                      <span>{theme === "light" ? "Claro" : theme === "dark" ? "Escuro" : "Terroso"}</span>
                      <span className="text-xs font-normal text-[#626f86]">{preferences.theme === theme ? "Selecionado" : "Selecionar"}</span>
                    </button>
                  ))}
                </div>
                <label className="mt-5 flex items-center justify-between gap-3 border-t border-[#dfe1e6] pt-4 text-sm">
                  <span>
                    <strong>Cartões compactos</strong>
                    <small className="mt-1 block text-[#626f86]">
                      Reduz o espaço vertical dos cartões.
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={preferences.compactCards}
                    onChange={(e) =>
                      preference("compactCards", e.target.checked)
                    }
                    className="h-4 w-4"
                  />
                </label>
              </section>
              <section className="rounded-xl border border-[#dfe1e6] bg-white p-6 shadow-sm">
                <h2 className="mb-1 text-lg font-bold">
                  Notificações e atalhos
                </h2>
                <p className="mb-5 text-sm text-[#626f86]">
                  Ajuste o comportamento da interface.
                </p>
                <div className="space-y-4">
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>
                      <strong>Notificações no aplicativo</strong>
                      <small className="mt-1 block text-[#626f86]">
                        Prazos e menções na central.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={preferences.notifications}
                      onChange={(e) =>
                        preference("notifications", e.target.checked)
                      }
                      className="h-4 w-4"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 border-t border-[#dfe1e6] pt-4 text-sm">
                    <span>
                      <strong>Notificações por e-mail</strong>
                      <small className="mt-1 block text-[#626f86]">
                        Receba por e-mail as notificações que chegarem à central. Requer e-mail confirmado e SMTP configurado.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={preferences.emailNotifications === true}
                      onChange={(e) => preference("emailNotifications", e.target.checked)}
                      className="h-4 w-4"
                    />
                  </label>
                  <div className="border-t border-[#dfe1e6] pt-4">
                    <label className="flex items-center justify-between gap-3 text-sm">
                      <span>
                        <strong>Notificações enquanto o Orbit está aberto</strong>
                        <small className="mt-1 block text-[#626f86]">
                          Avisos locais para atividades recebidas enquanto a aplicação está aberta.
                        </small>
                      </span>
                      <input
                        type="checkbox"
                        checked={preferences.browserNotifications}
                        onChange={browserNotifications}
                        className="h-4 w-4"
                      />
                    </label>
                    <p className="mt-2 text-xs text-[#626f86]">
                      Requer permissão do navegador.
                    </p>
                  </div>
                  <label className="flex items-center justify-between gap-3 border-t border-[#dfe1e6] pt-4 text-sm">
                    <span>
                      <strong>Notificações push</strong>
                      <small className="mt-1 block text-[#626f86]">
                        Receba avisos neste dispositivo mesmo com o Orbit fechado. O conteúdo pode aparecer na tela bloqueada.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={pushSubscribed}
                      disabled={pushBusy || (!pushEnabled && !pushSubscribed)}
                      onChange={(event) => void togglePushNotifications(event.target.checked)}
                      aria-label="Ativar notificações push neste navegador"
                      className="h-4 w-4"
                    />
                  </label>
                  {!pushEnabled && <p className="mt-2 text-xs text-[#626f86]">O serviço push não está configurado neste ambiente.</p>}
                  <label className="flex items-center justify-between gap-3 border-t border-[#dfe1e6] pt-4 text-sm">
                    <span>
                      <strong>Atalhos de teclado</strong>
                      <small className="mt-1 block text-[#626f86]">
                        / busca · Ctrl+Z desfaz · Ctrl+Shift+Z refaz.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={preferences.shortcuts}
                      onChange={(e) =>
                        preference("shortcuts", e.target.checked)
                      }
                      className="h-4 w-4"
                    />
                  </label>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
      {create && canCreateBoard && (
        <CreateBoardModal
          onClose={() => setCreate(false)}
          onCreate={createBoard}
        />
      )}
      {confirmationModal}
    </div>
  );
}
