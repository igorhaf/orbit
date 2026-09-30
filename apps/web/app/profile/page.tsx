"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { remember } from "@/lib/history";
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
  setUser,
} from "@/lib/api";
import {
  AppHeader,
  Avatar,
  CreateBoardModal,
  useConfirmModal,
  WorkspaceSidebar,
} from "@/components/ui";
import { useHydrated } from "@/lib/use-hydrated";
import { CalendarIntegrations } from "@/components/calendar-integrations";
import { AiEffortField, AiModelFields } from "@/components/ai-model-fields";

type DropboxStatus = { configured: boolean; connections: Array<{ id: string; display_name: string; label: string; status: string; metadata: { email?: string | null } }> };
type EnvironmentSettings = { groups: Array<{ id:string; label:string; fields:Array<{key:string;label:string;secret:boolean;value:string;configured:boolean}> }> };
type Tab = "profile" | "activity" | "cards" | "projects" | "integrations" | "settings";
const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "profile", label: "Perfil", icon: UserRound },
  { id: "activity", label: "Atividade", icon: ActivityIcon },
  { id: "cards", label: "Cartões atribuídos", icon: CheckSquare },
  { id: "projects", label: "Projetos", icon: FolderKanban },
  { id: "integrations", label: "Integrações", icon: Link2 },
  { id: "settings", label: "Configurações", icon: Palette },
];
export default function ProfilePage() {
  const router = useRouter();
  const { confirm, confirmationModal } = useConfirmModal();
  const [user, setCurrentUser] = useState<User | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [cards, setCards] = useState<HomeCard[]>([]);
  const [projects, setProjects] = useState<AiProject[]>([]);
  const [models, setModels] = useState<AiModel[]>([]);
  const [projectName, setProjectName] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [directoryPicker, setDirectoryPicker] = useState<{path:string;parent:string|null;name:string;folders:Array<{name:string;path:string}>}|null>(null);
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);
  const [directoryPickerLoading, setDirectoryPickerLoading] = useState(false);
  const [directoryPickerError, setDirectoryPickerError] = useState("");
  const [savingProject, setSavingProject] = useState(false);
  const [dropbox, setDropbox] = useState<DropboxStatus | null>(null);
  const [environment, setEnvironment] = useState<EnvironmentSettings | null>(null);
  const [environmentDraft, setEnvironmentDraft] = useState<Record<string,string>>({});
  const [clearEnvironment, setClearEnvironment] = useState<string[]>([]);
  const [savingEnvironment, setSavingEnvironment] = useState(false);
  const ready = useHydrated();
  const [tab, setTab] = useState<Tab>("profile");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [create, setCreate] = useState(false);
  const load = useCallback(async () => {
    try {
      const [account, all, activity, assigned, projectList, dropboxStatus, availableModels] = await Promise.all(
        [
          api<User>("/account"),
          api<Board[]>("/boards"),
          api<Activity[]>("/account/activity"),
          api<HomeCard[]>("/account/cards"),
          api<AiProject[]>("/ai/projects"),
          api<DropboxStatus>("/dropbox/status"),
          api<AiModel[]>("/ai/models"),
        ],
      );
      setCurrentUser(account);
      setUser(account);
      setName(account.name);
      setBoards(all);
      setActivities(activity);
      setCards(assigned);
      setProjects(projectList);
      setModels(availableModels);
      setDropbox(dropboxStatus);
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
      setEnvironmentDraft(Object.fromEntries(settings.groups.flatMap((group) => group.fields.map((field) => [field.key, field.value]))));
    }).catch((err) => setError((err as Error).message));
  }, [tab]);
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
  async function preference(
    key: keyof Preferences,
    value: Preferences[keyof Preferences],
  ) {
    try {
      const account = await send<User>("/account/preferences", "PATCH", {
        [key]: value,
      });
      setCurrentUser(account);
      setUser(account);
      setNotice("Preferências salvas.");
      setError("");
    } catch (err) {
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
  async function saveProjectAi(projectId: string, body: { ai_default_model?: string | null; ai_default_effort?: AiEffort | null }) {
    try {
      const updated = await send<AiProject>(`/ai/projects/${projectId}`, "PATCH", body);
      setProjects((current) => current.map((project) => project.id === projectId ? updated : project));
      setNotice("Configuração do projeto salva.");
      setError("");
    } catch (err) { setError((err as Error).message); }
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
  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    setSavingProject(true);
    setError("");
    try {
      const payload = {
        name: projectName,
        local_path: projectPath,
      };
      let project: AiProject;
      try {
        project = await send<AiProject>("/ai/projects", "POST", payload);
      } catch (err) {
        if ((err as Error & { code?:string }).code !== "PROJECT_DIRECTORY_MISSING") throw err;
        if (!window.confirm(`${(err as Error).message}\n\nDeseja criar essa pasta no servidor do Orbit e cadastrar o projeto?`)) return;
        project = await send<AiProject>("/ai/projects", "POST", { ...payload, create_directory:true });
      }
      setProjects(
        [...projects, project].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setProjectName("");
      setProjectPath("");
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
  async function connectDropbox() {
    try {
      const { url } = await api<{ url: string }>("/dropbox/oauth/start");
      window.location.assign(url);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function saveEnvironment(event: React.FormEvent) {
    event.preventDefault();
    setSavingEnvironment(true);
    try {
      const values = Object.fromEntries(Object.entries(environmentDraft).filter(([, value]) => value.length > 0));
      await send("/settings/environment", "PATCH", { values, clear: clearEnvironment });
      const settings = await api<EnvironmentSettings>("/settings/environment");
      setEnvironment(settings);
      setEnvironmentDraft(Object.fromEntries(settings.groups.flatMap((group) => group.fields.map((field) => [field.key, field.value]))));
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
  if (!ready) return <div className="min-h-screen bg-[#f7f8fa]" />;
  if (!user) return null;
  const preferences = user.preferences || {
    theme: "light",
    notifications: true,
    browserNotifications: false,
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
            {tabs.map((item) => (
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
                  <label className="mb-1 block text-xs font-bold">
                    E-mail da conta
                  </label>
                  <input
                    readOnly
                    value={user.email}
                    className="mb-5 w-full rounded border border-[#dfe1e6] bg-[#f1f2f4] px-3 py-2 text-sm text-[#626f86]"
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
                          className={`block truncate text-sm ${card.completed ? "text-[#626f86] line-through" : ""}`}
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
                          {project.is_native && (
                            <span className="text-xs font-semibold text-[#6554c0]">
                              Projeto nativo do Orbit
                            </span>
                          )}
                          <code className="block truncate text-xs text-[#626f86]">
                            {project.local_path}
                          </code>
                          <details className="mt-3 max-w-2xl rounded-lg border border-[#dfe1e6] p-3">
                            <summary className="cursor-pointer text-xs font-semibold">Configuração de IA do projeto</summary>
                            <div className="mt-3 space-y-3">
                              <AiModelFields value={project.ai_default_model} inheritedValue={user?.ai_default_model} models={models} onSave={(value) => saveProjectAi(project.id, { ai_default_model: value })} />
                              <AiEffortField value={project.ai_default_effort} inheritedValue={user?.ai_default_effort} onChange={(value) => saveProjectAi(project.id, { ai_default_effort: value })} />
                            </div>
                          </details>
                        </div>
                        {project.is_native ? (
                          <span className="text-xs text-[#626f86]">Integrado</span>
                        ) : (
                          <button
                            onClick={() => void removeProject(project.id)}
                            className="text-xs text-[#ae2a19]"
                          >
                            Remover
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <form
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
                <button type="button" onClick={() => { setDirectoryPickerOpen(true); void browseProjectDirectory(); }} className="mt-2 rounded border border-[#c1c7d0] px-3 py-2 text-xs font-semibold text-[#344563] hover:bg-[#f7f8fa]">Navegar pelas pastas</button>
                <p className="mt-2 text-xs text-[#626f86]">Informe um caminho absoluto acessível pelo servidor do Orbit. Se a pasta não existir, perguntaremos antes de criá-la.</p>
                <button disabled={savingProject || !projectName.trim() || !projectPath.trim()} className="mt-4 rounded bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {savingProject ? "Salvando..." : "Adicionar"}
                </button>
              </form>
              {directoryPickerOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setDirectoryPickerOpen(false);}}>
                  <section role="dialog" aria-modal="true" aria-labelledby="directory-picker-title" className="flex max-h-[min(80vh,640px)] w-full max-w-xl flex-col rounded-xl bg-white shadow-xl">
                    <header className="border-b border-[#dfe1e6] px-5 py-4"><h2 id="directory-picker-title" className="text-lg font-bold">Selecionar pasta do projeto</h2><p className="mt-1 break-all text-xs text-[#626f86]">{directoryPicker?.path || "Carregando caminho…"}</p></header>
                    {directoryPicker?.parent && <button type="button" disabled={directoryPickerLoading} onClick={()=>void browseProjectDirectory(directoryPicker.parent!)} className="flex items-center gap-2 border-b border-[#f1f2f4] px-5 py-3 text-left text-sm font-semibold text-[#344563] hover:bg-[#f7f8fa]"><ChevronUp size={16}/> Pasta anterior</button>}
                    {directoryPickerError && <p role="alert" className="px-5 py-3 text-sm text-[#ae2a19]">{directoryPickerError}</p>}
                    <div className="min-h-0 flex-1 overflow-y-auto">
                      {directoryPickerLoading ? <p className="p-5 text-sm text-[#626f86]">Carregando pastas…</p> : directoryPicker?.folders.length ? directoryPicker.folders.map(folder=><button key={folder.path} type="button" onClick={()=>void browseProjectDirectory(folder.path)} className="flex w-full items-center gap-3 border-b border-[#f1f2f4] px-5 py-3 text-left text-sm hover:bg-[#f7f8fa]"><Folder size={17} className="shrink-0 text-[#6554c0]"/><span className="truncate">{folder.name}</span></button>) : !directoryPickerError && <p className="p-5 text-sm text-[#626f86]">Nenhuma subpasta acessível.</p>}
                    </div>
                    <footer className="flex justify-end gap-2 border-t border-[#dfe1e6] p-4"><button type="button" onClick={()=>setDirectoryPickerOpen(false)} className="rounded border border-[#c1c7d0] px-4 py-2 text-sm font-semibold">Cancelar</button><button type="button" disabled={!directoryPicker || directoryPickerLoading} onClick={()=>{if(directoryPicker)setProjectPath(directoryPicker.path);setDirectoryPickerOpen(false);}} className="rounded bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Selecionar esta pasta</button></footer>
                  </section>
                </div>
              )}
            </div>
          )}
          {tab === "integrations" && (
            <div className="space-y-6">
            <CalendarIntegrations />
            <form onSubmit={saveEnvironment} className="max-w-4xl rounded-xl border border-[#dfe1e6] bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold">Configurações do servidor</h2>
              <p className="mt-1 text-sm leading-6 text-[#626f86]">Variáveis do arquivo .env agrupadas por integração e serviço. Os valores sensíveis são exibidos integralmente nesta tela. Campos vazios mantêm o valor atual; use “Remover” para apagar uma configuração.</p>
              <div className="mt-5 space-y-5">
                {environment?.groups.map((group) => (
                  <section key={group.id} className="rounded-lg border border-[#dfe1e6] p-4">
                    <h3 className="mb-3 text-sm font-bold">{group.label}</h3>
                    {group.id === "dropbox" && dropbox && (!dropbox.configured ? (
                      <div className="mb-4 rounded-lg bg-[#fff7d6] p-3 text-sm text-[#7f5f01]">Preencha as credenciais do app nos campos abaixo e reinicie a API para habilitar conexões Dropbox.</div>
                    ) : dropbox.connections.length === 0 ? (
                      <button type="button" onClick={() => void connectDropbox()} className="mb-4 rounded bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0055cc]">Conectar Dropbox</button>
                    ) : (
                      <div className="mb-4 space-y-3">
                        {dropbox.connections.map((connection) => <div key={connection.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#dfe1e6] p-3"><div><strong className="block text-sm">{connection.display_name || connection.label}</strong><span className="text-xs text-[#626f86]">{connection.metadata?.email || "Conta Dropbox"} · {connection.status === "active" ? "Conectada" : connection.status}</span></div><span className="rounded-full bg-[#e3fcef] px-2 py-1 text-xs font-semibold text-[#216e4e]">Ativa</span></div>)}
                        <button type="button" onClick={() => void connectDropbox()} className="text-sm font-semibold text-[#0c66e4] hover:underline">Conectar outra conta</button>
                      </div>
                    ))}
                    <div className="grid gap-3 md:grid-cols-2">
                      {group.fields.map((field) => (
                        <label key={field.key} className="min-w-0 text-xs font-semibold text-[#344563]">
                          {field.label}
                          {field.secret ? (
                            <textarea
                              autoComplete="off"
                              spellCheck={false}
                              rows={Math.min(5, Math.max(2, (environmentDraft[field.key] || "").split("\n").length))}
                              value={environmentDraft[field.key] || ""}
                              onChange={(event) => { setEnvironmentDraft((current) => ({ ...current, [field.key]:event.target.value })); if (event.target.value) setClearEnvironment((current) => current.filter((key) => key !== field.key)); }}
                              placeholder="Não configurado"
                              className="mt-1 w-full resize-y rounded border border-[#c1c7d0] px-3 py-2 text-sm font-normal text-[#172b4d]"
                            />
                          ) : (
                            <input
                              type="text"
                              autoComplete="off"
                              spellCheck={false}
                              value={environmentDraft[field.key] || ""}
                              onChange={(event) => { setEnvironmentDraft((current) => ({ ...current, [field.key]:event.target.value })); if (event.target.value) setClearEnvironment((current) => current.filter((key) => key !== field.key)); }}
                              placeholder="Não configurado"
                              className="mt-1 w-full rounded border border-[#c1c7d0] px-3 py-2 text-sm font-normal text-[#172b4d]"
                            />
                          )}
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
          {tab === "settings" && (
            <div className="grid gap-6 md:grid-cols-2">
              <section className="rounded-xl border border-[#c3b6f7] bg-[#f7f5ff] p-6 shadow-sm">
                <h2 className="mb-1 text-lg font-bold text-[#403294]">IA global</h2>
                <p className="mb-5 text-sm text-[#626f86]">Base de modelo e esforço para projetos, quadros e cartões sem configuração própria. Sem escolha, o campo continua vazio.</p>
                <div className="space-y-4">
                  <AiModelFields value={user?.ai_default_model} models={models} onSave={(value) => saveGlobalAi({ ai_default_model: value })} />
                  <AiEffortField value={user?.ai_default_effort} onChange={(value) => saveGlobalAi({ ai_default_effort: value })} />
                </div>
              </section>
              <section className="rounded-xl border border-[#dfe1e6] bg-white p-6 shadow-sm">
                <h2 className="mb-1 text-lg font-bold">Aparência</h2>
                <p className="mb-5 text-sm text-[#626f86]">
                  Escolha como o Orbit aparece para você.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {(["light", "dark"] as const).map((theme) => (
                    <button
                      key={theme}
                      onClick={() => preference("theme", theme)}
                      className={`flex flex-col items-center gap-2 rounded-lg border-2 p-5 text-sm font-semibold text-[#172b4d] ${preferences.theme === theme ? "border-[#0c66e4] bg-[#e9f2ff]" : "border-[#dfe1e6] hover:border-[#8590a2]"}`}
                    >
                      {theme === "light" ? (
                        <Palette size={25} />
                      ) : (
                        <Moon size={25} />
                      )}{" "}
                      {theme === "light" ? "Claro" : "Escuro"}
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
                  <div className="border-t border-[#dfe1e6] pt-4">
                    <label className="flex items-center justify-between gap-3 text-sm">
                      <span>
                        <strong>Notificações do navegador</strong>
                        <small className="mt-1 block text-[#626f86]">
                          Avisos fora da aba, quando permitidos.
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
                      Disponível em localhost ou HTTPS com permissão do
                      navegador.
                    </p>
                  </div>
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
      {create && (
        <CreateBoardModal
          onClose={() => setCreate(false)}
          onCreate={createBoard}
        />
      )}
      {confirmationModal}
    </div>
  );
}
