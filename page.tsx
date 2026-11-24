"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

type Tab = "overview" | "tasks" | "members" | "chat" | "meetings" | "assistant" | "reports" | "notifications";
type Workspace = { id: string; name: string; invite_code: string; owner_id: string };
type Member = { id: string; workspace_id: string; user_id: string; email: string; display_name: string; role: string; joined_at: string };
type Task = { id: string; workspace_id: string; title: string; description: string; status: "todo" | "in_progress" | "done"; priority: "low" | "medium" | "high"; due_date: string | null; assigned_to: string | null; created_by: string; attachment_path: string | null; attachment_name: string | null; created_at: string };
type Meeting = { id: string; workspace_id: string; title: string; starts_at: string; room_name: string; notes: string; transcript: string; created_by: string; created_at: string };
type Message = { id: string; workspace_id: string; sender_id: string; sender_name: string; body: string; created_at: string };
type Notice = { id: string; workspace_id: string; user_id: string; message: string; read: boolean; created_at: string };
type ChatLine = { role: "user" | "assistant"; content: string };

const NAV: { id: Tab; label: string; icon: string }[] = [
  { id: "overview", label: "Tổng quan", icon: "▦" },
  { id: "tasks", label: "Công việc", icon: "☑" },
  { id: "members", label: "Thành viên", icon: "♧" },
  { id: "chat", label: "Chat nhóm", icon: "▤" },
  { id: "meetings", label: "Cuộc họp", icon: "▣" },
  { id: "assistant", label: "Trợ lý AI", icon: "✦" },
  { id: "reports", label: "Báo cáo", icon: "▥" },
  { id: "notifications", label: "Thông báo", icon: "♢" },
];

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceName, setWorkspaceName] = useState("Nhóm của tôi");
  const [inviteCode, setInviteCode] = useState("");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);

  const [tab, setTab] = useState<Tab>("overview");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [notifications, setNotifications] = useState<Notice[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskAssignee, setTaskAssignee] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [taskPriority, setTaskPriority] = useState<Task["priority"]>("medium");
  const [taskFile, setTaskFile] = useState<File | null>(null);
  const taskFileInputRef = useRef<HTMLInputElement | null>(null);
  const [taskStatusFilter, setTaskStatusFilter] = useState("all");
  const [messageText, setMessageText] = useState("");
  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [activeMeetingId, setActiveMeetingId] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [chatLines, setChatLines] = useState<ChatLine[]>([]);
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recordingError, setRecordingError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const cleanupRecordingRef = useRef<(() => void) | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const currentUser = session?.user;
  const currentMember = members.find((m) => m.user_id === currentUser?.id);
  const activeMeeting = meetings.find((m) => m.id === activeMeetingId) || meetings[0] || null;
  const completed = tasks.filter((t) => t.status === "done").length;
  const inProgress = tasks.filter((t) => t.status === "in_progress").length;
  const todo = tasks.filter((t) => t.status === "todo").length;
  const percent = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
  const unreadCount = notifications.filter((n) => !n.read).length;
  const overdueTasks = tasks.filter((t) => t.status !== "done" && t.due_date && new Date(`${t.due_date}T23:59:59`) < new Date());
  const dueSoonTasks = tasks.filter((t) => { if (t.status === "done" || !t.due_date) return false; const due = new Date(`${t.due_date}T23:59:59`); const now = new Date(); return due >= now && due.getTime() - now.getTime() <= 48 * 60 * 60 * 1000; });
  const filteredTasks = useMemo(() => taskStatusFilter === "all" ? tasks : tasks.filter((t) => t.status === taskStatusFilter), [tasks, taskStatusFilter]);
  const pageTitle = NAV.find((n) => n.id === tab)?.label || "Tổng quan";

  const loadWorkspaceData = useCallback(async (workspaceId: string) => {
    setDataLoading(true);
    const [taskRes, memberRes, meetingRes, messageRes, noticeRes] = await Promise.all([
      supabase.from("team_tasks").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
      supabase.from("workspace_members").select("*").eq("workspace_id", workspaceId).order("joined_at", { ascending: true }),
      supabase.from("team_meetings").select("*").eq("workspace_id", workspaceId).order("starts_at", { ascending: true }),
      supabase.from("team_messages").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: true }).limit(200),
      supabase.from("workspace_notifications").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(80),
    ]);
    const errors = [taskRes.error, memberRes.error, meetingRes.error, messageRes.error, noticeRes.error].filter(Boolean);
    if (taskRes.data) setTasks(taskRes.data as Task[]);
    if (memberRes.data) setMembers(memberRes.data as Member[]);
    if (meetingRes.data) setMeetings(meetingRes.data as Meeting[]);
    if (messageRes.data) setMessages(messageRes.data as Message[]);
    if (noticeRes.data) setNotifications(noticeRes.data as Notice[]);
    if (errors.length) setNotice("Một số dữ liệu chưa tải được. Hãy kiểm tra đã chạy file SQL nâng cấp trong Supabase chưa. Chi tiết: " + (errors[0] as any).message);
    setDataLoading(false);
  }, []);

  const loadWorkspace = useCallback(async (userId: string) => {
    setWorkspaceLoading(true);
    const { data: membership, error: membershipError } = await supabase.from("workspace_members").select("workspace_id").eq("user_id", userId).order("joined_at", { ascending: true }).limit(1).maybeSingle();
    if (membershipError) {
      setNotice("Chưa tìm thấy cấu trúc nhóm. Bạn cần chạy file supabase/team_workspace.sql trong Supabase SQL Editor. Chi tiết: " + membershipError.message);
      setWorkspace(null);
      setWorkspaceLoading(false);
      return;
    }
    if (!membership?.workspace_id) {
      setWorkspace(null);
      setTasks([]); setMembers([]); setMeetings([]); setMessages([]); setNotifications([]);
      setWorkspaceLoading(false);
      return;
    }
    const { data, error } = await supabase.from("workspaces").select("id,name,invite_code,owner_id").eq("id", membership.workspace_id).single();
    if (error || !data) {
      setNotice("Không tải được không gian nhóm: " + (error?.message || "Không tìm thấy nhóm."));
      setWorkspace(null);
    } else {
      setWorkspace(data as Workspace);
      await loadWorkspaceData(data.id);
    }
    setWorkspaceLoading(false);
  }, [loadWorkspaceData]);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setAuthLoading(false);
    }).catch(() => { if (alive) setAuthLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session?.user.id) {
      setWorkspace(null); setWorkspaceLoading(false);
      return;
    }
    void loadWorkspace(session.user.id);
  }, [session?.user.id, loadWorkspace]);

  useEffect(() => {
    if (!workspace?.id) return;
    const channel = supabase.channel(`team-workspace-${workspace.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_messages", filter: `workspace_id=eq.${workspace.id}` }, () => {
        void supabase.from("team_messages").select("*").eq("workspace_id", workspace.id).order("created_at", { ascending: true }).limit(200).then(({ data }) => { if (data) setMessages(data as Message[]); });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "team_tasks", filter: `workspace_id=eq.${workspace.id}` }, () => { void loadWorkspaceData(workspace.id); })
      .on("postgres_changes", { event: "*", schema: "public", table: "team_meetings", filter: `workspace_id=eq.${workspace.id}` }, () => { void loadWorkspaceData(workspace.id); })
      .on("postgres_changes", { event: "*", schema: "public", table: "workspace_notifications", filter: `workspace_id=eq.${workspace.id}` }, () => { void loadWorkspaceData(workspace.id); })
      .subscribe();
    const timer = window.setInterval(() => { void loadWorkspaceData(workspace.id); }, 20000);
    return () => { window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, [workspace?.id, loadWorkspaceData]);

  useEffect(() => {
    if (activeMeeting) setNoteDraft(activeMeeting.notes || "");
  }, [activeMeeting?.id]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, chatLines]);

  async function handleAuth(event: FormEvent) {
    event.preventDefault(); setAuthBusy(true); setAuthMessage("");
    try {
      if (authMode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email: authEmail.trim(), password: authPassword, options: { data: { full_name: authName.trim() } } });
        if (error) throw error;
        setAuthMessage(data.session ? "Tạo tài khoản thành công." : "Đã tạo tài khoản. Hãy mở email và xác nhận trước khi đăng nhập.");
        if (!data.session) setAuthMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword });
        if (error) throw error;
        setAuthMessage("Đăng nhập thành công.");
      }
    } catch (error) { setAuthMessage((error as Error).message || "Không thể xác thực tài khoản."); }
    setAuthBusy(false);
  }

  async function createWorkspace(event: FormEvent) {
    event.preventDefault();
    if (!currentUser || workspaceName.trim().length < 2) return;
    setWorkspaceBusy(true); setNotice("");
    const { data, error } = await supabase.from("workspaces").insert({ name: workspaceName.trim(), owner_id: currentUser.id }).select("id,name,invite_code,owner_id").single();
    if (error || !data) setNotice("Không tạo được nhóm: " + (error?.message || "Lỗi không xác định."));
    else {
      setWorkspace(data as Workspace);
      await loadWorkspaceData(data.id);
      setNotice("Đã tạo nhóm. Gửi mã tham gia cho các thành viên.");
      // Copy the old personal tasks into the new shared workspace when the legacy table is available.
      const { data: oldTasks } = await supabase.from("tasks").select("title,completed").eq("user_id", currentUser.id).limit(100);
      if (oldTasks?.length) {
        const rows = oldTasks.map((t: any) => ({ workspace_id: data.id, title: t.title, status: t.completed ? "done" : "todo", created_by: currentUser.id }));
        const { error: copyError } = await supabase.from("team_tasks").insert(rows);
        if (!copyError) await loadWorkspaceData(data.id);
      }
    }
    setWorkspaceBusy(false);
  }

  async function renameWorkspace() {
    if (!workspace || !currentUser || workspace.owner_id !== currentUser.id) {
      setNotice("Chỉ trưởng nhóm mới được đổi tên nhóm.");
      return;
    }
    const entered = window.prompt("Nhập tên nhóm mới:", workspace.name);
    if (entered === null) return;
    const nextName = entered.trim();
    if (nextName.length < 2) {
      setNotice("Tên nhóm phải có ít nhất 2 ký tự.");
      return;
    }
    if (nextName.length > 80) {
      setNotice("Tên nhóm không được dài quá 80 ký tự.");
      return;
    }
    if (nextName === workspace.name) return;

    setWorkspaceBusy(true);
    setNotice("");
    const { data, error } = await supabase
      .from("workspaces")
      .update({ name: nextName })
      .eq("id", workspace.id)
      .eq("owner_id", currentUser.id)
      .select("id,name,invite_code,owner_id")
      .single();

    if (error || !data) {
      setNotice("Không đổi được tên nhóm: " + (error?.message || "Không nhận được dữ liệu sau khi lưu."));
    } else {
      setWorkspace(data as Workspace);
      setNotice("Đã đổi tên nhóm thành công.");
    }
    setWorkspaceBusy(false);
  }

  async function joinWorkspace(event: FormEvent) {
    event.preventDefault();
    if (!inviteCode.trim()) return;
    setWorkspaceBusy(true); setNotice("");
    const { data, error } = await supabase.rpc("join_workspace_by_code", { p_invite_code: inviteCode.trim().toUpperCase() });
    if (error || !data) setNotice("Không tham gia được nhóm: " + (error?.message || "Kiểm tra mã mời."));
    else {
      const { data: ws, error: wsError } = await supabase.from("workspaces").select("id,name,invite_code,owner_id").eq("id", data).single();
      if (wsError || !ws) setNotice("Đã gửi yêu cầu tham gia nhưng chưa tải được nhóm: " + (wsError?.message || "Lỗi."));
      else { setWorkspace(ws as Workspace); await loadWorkspaceData(ws.id); setNotice("Bạn đã tham gia nhóm thành công."); }
    }
    setWorkspaceBusy(false);
  }

  async function createTask(event: FormEvent) {
    event.preventDefault();
    if (!workspace || !currentUser || !taskTitle.trim()) return;
    setBusy(true);
    let attachmentPath: string | null = null;
    let attachmentName: string | null = null;
    if (taskFile) {
      if (taskFile.size > 10 * 1024 * 1024) { setNotice("Tệp đính kèm tối đa 10 MB."); setBusy(false); return; }
      const safeName = taskFile.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
      attachmentPath = `${workspace.id}/${currentUser.id}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from("ai-teamwork-files").upload(attachmentPath, taskFile, { upsert: false });
      if (uploadError) { setNotice("Không tải được tệp: " + uploadError.message + ". Hãy kiểm tra đã chạy SQL nâng cấp và Storage bucket chưa."); setBusy(false); return; }
      attachmentName = taskFile.name;
    }
    const { data, error } = await supabase.from("team_tasks").insert({
      workspace_id: workspace.id, title: taskTitle.trim(), description: taskDescription.trim(),
      assigned_to: taskAssignee || null, due_date: taskDue || null, priority: taskPriority, status: "todo", created_by: currentUser.id,
      attachment_path: attachmentPath, attachment_name: attachmentName,
    }).select().single();
    if (error) {
      if (attachmentPath) await supabase.storage.from("ai-teamwork-files").remove([attachmentPath]);
      setNotice("Không tạo được công việc: " + error.message);
    } else if (data) { setTasks((old) => [data as Task, ...old]); setTaskTitle(""); setTaskDescription(""); setTaskAssignee(""); setTaskDue(""); setTaskPriority("medium"); setTaskFile(null); if (taskFileInputRef.current) taskFileInputRef.current.value = ""; setNotice("Đã tạo công việc trong nhóm."); }
    setBusy(false);
  }

  async function updateTask(task: Task, patch: Partial<Task>) {
    const { data, error } = await supabase.from("team_tasks").update(patch).eq("id", task.id).select().single();
    if (error) setNotice("Không cập nhật được công việc: " + error.message);
    else if (data) setTasks((old) => old.map((t) => t.id === task.id ? data as Task : t));
  }

  async function deleteTask(taskId: string) {
    if (!window.confirm("Bạn chắc chắn muốn xóa công việc này?")) return;
    const { error } = await supabase.from("team_tasks").delete().eq("id", taskId);
    if (error) setNotice("Không xóa được công việc: " + error.message);
    else setTasks((old) => old.filter((t) => t.id !== taskId));
  }

  async function renameMember(member: Member) {
    if (!currentUser) return;
    if (member.user_id !== currentUser.id && currentMember?.role !== "owner") {
      setNotice("Bạn chỉ có thể đổi tên hiển thị của chính mình.");
      return;
    }
    const entered = window.prompt("Nhập tên hiển thị mới:", member.display_name);
    if (entered === null) return;
    const nextName = entered.trim();
    if (nextName.length < 2 || nextName.length > 50) {
      setNotice("Tên thành viên phải có từ 2 đến 50 ký tự.");
      return;
    }
    if (nextName === member.display_name) return;

    setBusy(true);
    setNotice("");
    const { error } = await supabase.rpc("rename_workspace_member", {
      p_member_id: member.id,
      p_display_name: nextName,
    });
    if (error) {
      setNotice("Không đổi được tên thành viên: " + error.message + ". Hãy chạy file supabase/rename_member.sql trong Supabase SQL Editor.");
    } else {
      setMembers((old) => old.map((m) => m.id === member.id ? { ...m, display_name: nextName } : m));
      setNotice("Đã cập nhật tên thành viên.");
    }
    setBusy(false);
  }

  async function changeMemberRole(member: Member, role: string) {
    const { error } = await supabase.from("workspace_members").update({ role }).eq("id", member.id);
    if (error) setNotice("Không đổi được quyền thành viên: " + error.message);
    else setMembers((old) => old.map((m) => m.id === member.id ? { ...m, role } : m));
  }

  async function removeMember(member: Member) {
    if (!window.confirm(`Xóa ${member.display_name} khỏi nhóm?`)) return;
    const { error } = await supabase.from("workspace_members").delete().eq("id", member.id);
    if (error) setNotice("Không xóa được thành viên: " + error.message);
    else setMembers((old) => old.filter((m) => m.id !== member.id));
  }

  async function openAttachment(task: Task) {
    if (!task.attachment_path) return;
    const { data, error } = await supabase.storage.from("ai-teamwork-files").createSignedUrl(task.attachment_path, 60);
    if (error || !data?.signedUrl) setNotice("Không mở được tệp đính kèm: " + (error?.message || "Không tạo được liên kết."));
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!workspace || !currentUser || !messageText.trim()) return;
    const senderName = currentMember?.display_name || currentUser.email?.split("@")[0] || "Thành viên";
    const { data, error } = await supabase.from("team_messages").insert({ workspace_id: workspace.id, sender_id: currentUser.id, sender_name: senderName, body: messageText.trim() }).select().single();
    if (error) setNotice("Không gửi được tin nhắn: " + error.message);
    else if (data) { setMessages((old) => [...old, data as Message]); setMessageText(""); }
  }

  async function createMeeting(event: FormEvent) {
    event.preventDefault();
    if (!workspace || !currentUser || !meetingTitle.trim() || !meetingDate) return;
    const roomName = `ai-teamwork-${workspace.id.slice(0, 7)}-${Math.random().toString(36).slice(2, 9)}`;
    const { data, error } = await supabase.from("team_meetings").insert({ workspace_id: workspace.id, title: meetingTitle.trim(), starts_at: new Date(meetingDate).toISOString(), room_name: roomName, created_by: currentUser.id }).select().single();
    if (error) setNotice("Không tạo được lịch họp: " + error.message);
    else if (data) { setMeetings((old) => [...old, data as Meeting].sort((a, b) => a.starts_at.localeCompare(b.starts_at))); setMeetingTitle(""); setMeetingDate(""); setActiveMeetingId(data.id); setNoteDraft(""); setNotice("Đã tạo lịch họp và phòng video. Chia sẻ link mời cho nhóm."); }
  }

  async function saveMeetingNotes() {
    if (!activeMeeting) return;
    const { error } = await supabase.from("team_meetings").update({ notes: noteDraft }).eq("id", activeMeeting.id);
    if (error) setNotice("Không lưu được biên bản: " + error.message);
    else { setMeetings((old) => old.map((m) => m.id === activeMeeting.id ? { ...m, notes: noteDraft } : m)); setNotice("Đã lưu biên bản cuộc họp."); }
  }

  async function startRecording() {
    setRecordingError("");
    if (!activeMeeting) { setRecordingError("Hãy chọn hoặc tạo một cuộc họp trước."); return; }
    if (!navigator.mediaDevices?.getDisplayMedia || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setRecordingError("Trình duyệt này không hỗ trợ ghi âm tab họp. Hãy dùng Chrome hoặc Edge mới."); return; }
    let tabStream: MediaStream | null = null;
    let micStream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    try {
      tabStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      if (!tabStream.getAudioTracks().length) {
        tabStream.getTracks().forEach((track) => track.stop());
        throw new Error("Bạn cần chọn tab Chrome đang họp và bật tùy chọn Chia sẻ âm thanh tab.");
      }
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new AudioContext();
      const mixedAudio = audioContext.createMediaStreamDestination();
      [tabStream, micStream].forEach((stream) => audioContext!.createMediaStreamSource(stream).connect(mixedAudio));
      const recorder = new MediaRecorder(mixedAudio.stream);
      chunksRef.current = [];
      const capturedTab = tabStream;
      const capturedMic = micStream;
      const capturedContext = audioContext;
      cleanupRecordingRef.current = () => {
        capturedTab.getTracks().forEach((track) => track.stop());
        capturedMic.getTracks().forEach((track) => track.stop());
        void capturedContext.close();
      };
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        cleanupRecordingRef.current?.(); cleanupRecordingRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) { setRecordingError("Không ghi được âm thanh."); return; }
        if (blob.size > 24 * 1024 * 1024) { setRecordingError("Bản ghi lớn hơn 24 MB. Hãy ghi âm thành đoạn ngắn hơn."); return; }
        setTranscribing(true);
        try {
          const form = new FormData();
          form.append("file", blob, "ai-teamwork-meeting.webm");
          const response = await fetch("/api/transcribe", { method: "POST", body: form });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Không chuyển được âm thanh thành văn bản.");
          const newTranscript = [activeMeeting.transcript, result.text].filter(Boolean).join("\n\n");
          const { error } = await supabase.from("team_meetings").update({ transcript: newTranscript }).eq("id", activeMeeting.id);
          if (error) throw error;
          setMeetings((old) => old.map((m) => m.id === activeMeeting.id ? { ...m, transcript: newTranscript } : m));
          setNotice("Đã chuyển âm thanh tab họp và micro thành văn bản, lưu vào cuộc họp.");
        } catch (error) { setRecordingError((error as Error).message); }
        setTranscribing(false);
      };
      recorder.start(); recorderRef.current = recorder; setRecording(true);
    } catch (error) {
      tabStream?.getTracks().forEach((track) => track.stop());
      micStream?.getTracks().forEach((track) => track.stop());
      if (audioContext) void audioContext.close();
      setRecordingError((error as Error).message || "Không mở được quyền ghi âm.");
    }
  }

  function stopRecording() { if (recorderRef.current && recorderRef.current.state !== "inactive") { recorderRef.current.stop(); setRecording(false); } }

  async function askAI(event?: FormEvent, prompt?: string) {
    event?.preventDefault();
    const question = (prompt || aiQuestion).trim();
    if (!question || aiBusy) return;
    const userLine: ChatLine = { role: "user", content: question };
    setChatLines((old) => [...old, userLine]); setAiQuestion(""); setAiBusy(true);
    const context = [
      `Nhóm: ${workspace?.name || ""}`,
      "CÔNG VIỆC:", ...tasks.map((t) => `- ${t.title} | ${t.status} | ưu tiên ${t.priority} | hạn ${t.due_date || "chưa đặt"} | người phụ trách ${members.find((m) => m.user_id === t.assigned_to)?.display_name || "chưa giao"}`),
      "CUỘC HỌP:", ...meetings.map((m) => `- ${m.title} | ${new Date(m.starts_at).toLocaleString("vi-VN")} | ghi chú: ${m.notes.slice(0, 1000)} | nội dung ghi âm: ${m.transcript.slice(0, 1000)}`),
      "THÀNH VIÊN:", ...members.map((m) => `- ${m.display_name} (${m.role})`),
    ].join("\n");
    try {
      const response = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [...chatLines, userLine], context }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "AI chưa phản hồi được.");
      setChatLines((old) => [...old, { role: "assistant", content: result.reply }]);
    } catch (error) { setChatLines((old) => [...old, { role: "assistant", content: "Chưa kết nối được AI: " + (error as Error).message }]); }
    setAiBusy(false);
  }

  async function markNotificationRead(item: Notice) {
    const { error } = await supabase.from("workspace_notifications").update({ read: true }).eq("id", item.id);
    if (!error) setNotifications((old) => old.map((n) => n.id === item.id ? { ...n, read: true } : n));
  }

  async function signOut() { await supabase.auth.signOut(); setWorkspace(null); setSession(null); }
  async function copyInvite() {
    if (!workspace) return;
    try { await navigator.clipboard.writeText(workspace.invite_code); setNotice("Đã sao chép mã tham gia nhóm."); }
    catch { setNotice("Mã tham gia nhóm: " + workspace.invite_code); }
  }
  function openVideo(meeting: Meeting) {
    const url = `https://meet.jit.si/${encodeURIComponent(meeting.room_name)}#config.prejoinPageEnabled=true&config.startWithAudioMuted=false&config.startWithVideoMuted=false`;
    window.open(url, "_blank", "noopener,noreferrer");
  }
  function copyMeetingLink(meeting: Meeting) {
    const url = `https://meet.jit.si/${encodeURIComponent(meeting.room_name)}`;
    if (!navigator.clipboard?.writeText) { setNotice(url); return; }
    navigator.clipboard.writeText(url).then(() => setNotice("Đã sao chép link video cuộc họp.")).catch(() => setNotice(url));
  }

  if (authLoading) return <div className="screen-center"><div className="loader"/>Đang kiểm tra đăng nhập...</div>;

  if (!session) return <main className="auth-screen"><section className="auth-card"><div className="brand auth-brand"><span className="brand-mark">✦</span><span>AI <b>TeamWork</b></span></div><p className="auth-subtitle">Không gian làm việc nhóm thông minh</p><h1>{authMode === "login" ? "Chào mừng bạn trở lại" : "Tạo tài khoản mới"}</h1><p className="muted">Đăng nhập hoặc đăng ký để bắt đầu làm việc cùng nhóm.</p><form onSubmit={handleAuth} className="auth-form">{authMode === "signup" && <label>Họ và tên<input value={authName} onChange={(e) => setAuthName(e.target.value)} required placeholder="Tên hiển thị"/></label>}<label>Email<input type="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} required placeholder="you@example.com"/></label><label>Mật khẩu<input type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} required minLength={6} placeholder="Ít nhất 6 ký tự"/></label><button className="primary-btn wide" disabled={authBusy}>{authBusy ? "Đang xử lý..." : authMode === "login" ? "Đăng nhập" : "Đăng ký"}</button></form>{authMessage && <div className="notice">{authMessage}</div>}<button className="link-button" onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setAuthMessage(""); }}>{authMode === "login" ? "Chưa có tài khoản? Đăng ký" : "Đã có tài khoản? Đăng nhập"}</button></section></main>;

  if (workspaceLoading) return <div className="screen-center"><div className="loader"/>Đang tải không gian làm việc...</div>;

  if (!workspace) return <main className="workspace-screen"><section className="workspace-choice"><div className="brand"><span className="brand-mark">✦</span><span>AI <b>TeamWork</b></span></div><h1>Bắt đầu không gian làm việc</h1><p>Tạo nhóm mới hoặc nhập mã mời do trưởng nhóm gửi cho bạn.</p>{notice && <div className="notice">{notice}</div>}<div className="workspace-choice-grid"><form className="panel" onSubmit={createWorkspace}><h2>Tạo nhóm mới</h2><label>Tên nhóm<input value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} required minLength={2} maxLength={80}/></label><button className="primary-btn wide" disabled={workspaceBusy}>＋ Tạo không gian nhóm</button></form><form className="panel" onSubmit={joinWorkspace}><h2>Tham gia nhóm</h2><label>Mã tham gia<input value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} placeholder="Ví dụ: 7A2B9C10" required/></label><button className="secondary-btn wide" disabled={workspaceBusy}>Tham gia nhóm →</button></form></div><button className="link-button" onClick={signOut}>Đăng xuất</button></section></main>;

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">✦</span><span>AI <b>TeamWork</b></span></div>
      <div className="workspace-label">KHÔNG GIAN LÀM VIỆC</div>
      <div className="workspace-chip"><span className="workspace-avatar">{workspace.name.slice(0, 1).toUpperCase()}</span><span><b>{workspace.name}</b><small>{members.length} thành viên</small></span></div>
      {currentMember?.role === "owner" && <button className="text-btn" style={{ margin: "7px 0 2px 38px" }} onClick={renameWorkspace} disabled={workspaceBusy}>✎ Đổi tên nhóm</button>}
      <div className="invite-card"><small>MÃ THAM GIA NHÓM</small><b>{workspace.invite_code}</b><button onClick={copyInvite}>Sao chép mã</button></div>
      <div className="nav-label">MENU CHÍNH</div>
      <nav>{NAV.map((item) => <button key={item.id} className={`nav-item ${tab === item.id ? "active" : ""}`} onClick={() => { setTab(item.id); setNotice(""); }}><span className="nav-icon">{item.icon}</span>{item.label}{item.id === "notifications" && unreadCount > 0 && <span className="nav-count">{unreadCount}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="help-card"><span>✦</span><b>Cần trợ giúp?</b><p>Hỏi AI về kế hoạch, phân công và tiến độ nhóm.</p><button onClick={() => setTab("assistant")}>Trò chuyện với AI →</button></div><div className="profile"><div className="profile-avatar">{(currentMember?.display_name || currentUser?.email || "U").slice(0, 1).toUpperCase()}</div><div><b>{currentMember?.display_name || currentUser?.email}</b><small>{currentMember?.role === "owner" ? "Trưởng nhóm" : "Thành viên"}</small></div><button title="Đăng xuất" onClick={signOut}>↪</button></div></div>
    </aside>

    <section className="main-area">
      <header className="topbar"><div className="breadcrumb">{workspace.name} <span>/</span> <b>{pageTitle}</b></div><div className="top-actions"><span className="online-dot"/> Đang hoạt động <button className="avatar-small" onClick={signOut} title="Đăng xuất">{(currentMember?.display_name || "U").slice(0, 1).toUpperCase()}</button></div></header>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow">WORK SMARTER TOGETHER</div><h1>{tab === "overview" ? `Xin chào, ${currentMember?.display_name || "đội nhóm"}! 👋` : pageTitle}</h1><p>{tab === "overview" ? "Cùng theo dõi công việc và đưa dự án tiến về phía trước." : pageDescription(tab)}</p></div>{tab === "tasks" && <button className="primary-btn" onClick={() => document.getElementById("new-task-title")?.focus()}>＋ Tạo công việc</button>}</div>
        {notice && <div className="notice"><span>ⓘ</span>{notice}<button onClick={() => setNotice("")}>×</button></div>}
        {dataLoading && <div className="loading-line">Đang đồng bộ dữ liệu nhóm...</div>}

        {tab === "overview" && <>
          <div className="stats-grid"><Stat label="TỔNG CÔNG VIỆC" value={tasks.length} hint="Trong không gian nhóm" icon="▦"/><Stat label="ĐÃ HOÀN THÀNH" value={completed} hint="Đã hoàn tất" icon="✓"/><Stat label="ĐANG THỰC HIỆN" value={inProgress} hint={`${todo} việc đang chờ`} icon="◷"/><Stat label="TIẾN ĐỘ CHUNG" value={`${percent}%`} hint="Theo công việc nhóm" icon="↗"/></div>
          <div className="dashboard-grid"><section className="panel"><div className="panel-heading"><div><h2>Công việc gần đây</h2><p>Việc mới và việc cần ưu tiên</p></div><button className="text-btn" onClick={() => setTab("tasks")}>Xem tất cả →</button></div><TaskRows tasks={tasks.slice(0, 6)} members={members} updateTask={updateTask} deleteTask={deleteTask} openAttachment={openAttachment}/></section><section className="panel progress-panel"><div className="panel-heading"><div><h2>Tiến độ nhóm</h2><p>Tỷ lệ hoàn thành</p></div><span className="soft-tag">{tasks.length} việc</span></div><div className="progress-ring" style={{ "--progress": `${percent}%` } as CSSProperties}><div><strong>{percent}%</strong><small>Hoàn thành</small></div></div><div className="legend"><span><i className="legend-dot done"/> Đã hoàn thành <b>{completed}</b></span><span><i className="legend-dot progress"/> Đang làm <b>{inProgress}</b></span><span><i className="legend-dot todo"/> Chưa làm <b>{todo}</b></span></div><div className="tip-box">✦ <span><b>{overdueTasks.length ? `${overdueTasks.length} công việc quá hạn` : "Mẹo nhỏ"}</b><br/>{overdueTasks.length ? "Mở mục Công việc để điều chỉnh hạn hoàn thành." : "Chia việc lớn thành nhiệm vụ nhỏ để cả nhóm dễ theo dõi."}</span></div></section></div>
          <div className="bottom-grid"><section className="panel"><div className="panel-heading"><div><h2>Thành viên nhóm</h2><p>Những người trong không gian làm việc</p></div><button className="text-btn" onClick={() => setTab("members")}>Xem thành viên →</button></div><MemberRows members={members.slice(0, 5)} isOwner={currentMember?.role === "owner"} currentUserId={currentUser?.id} onRename={renameMember} onRoleChange={changeMemberRole} onRemove={removeMember}/></section><section className="panel"><div className="panel-heading"><div><h2>Cuộc họp sắp tới</h2><p>Lịch đã được đồng bộ với nhóm</p></div><button className="text-btn" onClick={() => setTab("meetings")}>Xem lịch →</button></div>{meetings.filter((m) => new Date(m.starts_at) >= new Date()).slice(0, 3).map((m) => <div className="mini-item" key={m.id}><span className="meeting-icon">▣</span><div><b>{m.title}</b><small>{new Date(m.starts_at).toLocaleString("vi-VN")}</small></div></div>)}{!meetings.some((m) => new Date(m.starts_at) >= new Date()) && <div className="empty-inline">Chưa có cuộc họp sắp tới.</div>}</section></div>
        </>}

        {tab === "tasks" && <div className="tasks-layout"><section className="panel"><div className="panel-heading"><div><h2>Tạo công việc mới</h2><p>Giao việc cho thành viên, đặt ưu tiên và hạn hoàn thành.</p></div></div><form className="task-form" onSubmit={createTask}><label>Tên công việc<input id="new-task-title" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} required maxLength={180} placeholder="Ví dụ: Hoàn thiện slide thuyết trình"/></label><label>Mô tả<textarea value={taskDescription} onChange={(e) => setTaskDescription(e.target.value)} rows={2} placeholder="Mô tả yêu cầu hoặc kết quả cần đạt..."/></label><div className="form-grid"><label>Người phụ trách<select value={taskAssignee} onChange={(e) => setTaskAssignee(e.target.value)}><option value="">Chưa phân công</option>{members.map((m) => <option value={m.user_id} key={m.user_id}>{m.display_name}</option>)}</select></label><label>Hạn hoàn thành<input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)}/></label><label>Mức ưu tiên<select value={taskPriority} onChange={(e) => setTaskPriority(e.target.value as Task["priority"])}><option value="low">Thấp</option><option value="medium">Trung bình</option><option value="high">Cao</option></select></label></div><label>Tệp đính kèm (tối đa 10 MB)<input ref={taskFileInputRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.docx,.xlsx,.txt" onChange={(e) => setTaskFile(e.target.files?.[0] || null)}/></label><button className="primary-btn" disabled={busy}>{busy ? "Đang lưu..." : "＋ Tạo công việc"}</button></form></section><section className="panel"><div className="panel-heading"><div><h2>Danh sách công việc</h2><p>{tasks.length} công việc trong nhóm</p></div><select className="filter-select" value={taskStatusFilter} onChange={(e) => setTaskStatusFilter(e.target.value)}><option value="all">Tất cả trạng thái</option><option value="todo">Chưa làm</option><option value="in_progress">Đang làm</option><option value="done">Hoàn thành</option></select></div><TaskRows tasks={filteredTasks} members={members} updateTask={updateTask} deleteTask={deleteTask} openAttachment={openAttachment}/></section></div>}

        {tab === "members" && <section className="panel full-panel"><div className="panel-heading"><div><h2>Thành viên nhóm</h2><p>Chia sẻ mã tham gia để mời người khác vào cùng không gian.</p></div><span className="soft-tag">{members.length} thành viên</span></div><div className="invite-banner"><div><small>MÃ MỜI CỦA NHÓM</small><strong>{workspace.invite_code}</strong><p>Thành viên đăng ký/đăng nhập tài khoản rồi nhập mã này ở màn hình tham gia nhóm.</p></div><button className="primary-btn" onClick={copyInvite}>Sao chép mã mời</button></div><MemberRows members={members} isOwner={currentMember?.role === "owner"} currentUserId={currentUser?.id} onRename={renameMember} onRoleChange={changeMemberRole} onRemove={removeMember}/><p className="muted">Lưu ý: ứng dụng dùng mã mời trong nhóm, không tự gửi email. Bạn có thể gửi mã qua Zalo, Messenger hoặc email của nhóm.</p></section>}

        {tab === "chat" && <section className="panel chat-panel"><div className="panel-heading"><div><h2>Trao đổi nhóm</h2><p>Tin nhắn được lưu trong Supabase và hiển thị với thành viên cùng nhóm.</p></div><span className="soft-tag">{members.length} thành viên</span></div><div className="team-chat-list">{messages.length ? messages.map((m) => <div className={`team-chat-message ${m.sender_id === currentUser?.id ? "mine" : ""}`} key={m.id}><b>{m.sender_name}</b><p>{m.body}</p><small>{new Date(m.created_at).toLocaleString("vi-VN")}</small></div>) : <div className="empty-inline">Chưa có tin nhắn. Hãy gửi lời chào đầu tiên!</div>}<div ref={chatEndRef}/></div><form className="chat-form" onSubmit={sendMessage}><input value={messageText} onChange={(e) => setMessageText(e.target.value)} placeholder="Nhập tin nhắn cho nhóm..." maxLength={4000}/><button disabled={!messageText.trim()}>Gửi ↑</button></form></section>}

        {tab === "meetings" && <div className="meeting-layout"><section className="panel"><div className="panel-heading"><div><h2>Tạo lịch họp và phòng video</h2><p>Tạo một phòng riêng theo mã nhóm để cả nhóm tham gia.</p></div></div><form className="meeting-form" onSubmit={createMeeting}><label>Tên cuộc họp<input value={meetingTitle} onChange={(e) => setMeetingTitle(e.target.value)} required placeholder="Ví dụ: Họp phân chia công việc"/></label><label>Thời gian<input type="datetime-local" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} required/></label><button className="primary-btn">＋ Tạo lịch họp</button></form><div className="meeting-list">{meetings.map((m) => <div className={`meeting-row ${activeMeeting?.id === m.id ? "selected" : ""}`} key={m.id}><button className="meeting-select" onClick={() => { setActiveMeetingId(m.id); setNoteDraft(m.notes || ""); }}><span className="meeting-icon">▣</span><span><b>{m.title}</b><small>{new Date(m.starts_at).toLocaleString("vi-VN")}</small></span></button><div className="meeting-buttons"><button onClick={() => openVideo(m)}>Tham gia video ↗</button><button onClick={() => copyMeetingLink(m)}>Sao chép link</button></div></div>)}{!meetings.length && <div className="empty-inline">Chưa có lịch họp. Hãy tạo cuộc họp đầu tiên.</div>}</div></section>
          <section className="panel"><div className="panel-heading"><div><h2>{activeMeeting ? `Biên bản: ${activeMeeting.title}` : "Biên bản cuộc họp"}</h2><p>Lưu ghi chú và ghi âm để chuyển thành văn bản.</p></div></div>{activeMeeting ? <><label>Ghi chú / biên bản<textarea rows={6} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Nhập nội dung, kết luận và quyết định của cuộc họp..."/></label><div className="button-row"><button className="primary-btn" onClick={saveMeetingNotes}>Lưu biên bản</button>{recording ? <button className="danger-btn" onClick={stopRecording}>■ Dừng ghi âm</button> : <button className="secondary-btn" onClick={startRecording} disabled={transcribing}>● Ghi âm cuộc họp</button>}</div>{transcribing && <div className="loading-line">Đang chuyển âm thanh thành văn bản...</div>}{recordingError && <div className="error-inline">{recordingError}</div>}<div className="transcript-box"><b>Nội dung ghi âm đã chuyển</b><p>{activeMeeting.transcript || "Chưa có bản ghi âm."}</p></div><button className="secondary-btn" onClick={() => { setTab("assistant"); void askAI(undefined, `Hãy tóm tắt biên bản cuộc họp sau, nêu quyết định, nhiệm vụ, người phụ trách và deadline nếu có:\n\n${noteDraft}\n\nBản ghi âm chuyển thành văn bản:\n${activeMeeting.transcript}`); }} disabled={!noteDraft.trim() && !activeMeeting.transcript}>✦ AI tóm tắt cuộc họp</button></> : <div className="empty-inline">Chọn một cuộc họp hoặc tạo cuộc họp mới để ghi biên bản.</div>}<p className="muted">Video dùng phòng Jitsi công khai trong tab mới. Ghi âm cần chia sẻ tab Chrome đang họp, bật “Chia sẻ âm thanh tab” và cấp quyền micro. Chỉ ghi khi người tham gia đã được thông báo và đồng ý.</p></section></div>}

        {tab === "assistant" && <section className="panel assistant-panel"><div className="panel-heading"><div><h2>Trợ lý AI nhóm</h2><p>AI được cung cấp ngữ cảnh công việc, thành viên và cuộc họp hiện tại.</p></div><span className="ai-status">● Sẵn sàng khi có API key</span></div><div className="chat-area">{chatLines.length === 0 ? <div className="ai-welcome"><div className="ai-orb">✦</div><h3>Bạn cần nhóm hỗ trợ điều gì?</h3><p>Thử một yêu cầu gợi ý bên dưới.</p><div className="suggestions"><button onClick={() => setAiQuestion("Hãy lập kế hoạch công việc cho nhóm trong 7 ngày tới dựa trên danh sách hiện tại.")}>Lập kế hoạch 7 ngày</button><button onClick={() => setAiQuestion("Đánh giá tiến độ nhóm, chỉ ra công việc có nguy cơ trễ hạn.")}>Đánh giá tiến độ</button><button onClick={() => setAiQuestion("Đề xuất cách phân chia lại công việc cho các thành viên.")}>Cân bằng công việc</button><button onClick={() => setAiQuestion("Tóm tắt các cuộc họp gần đây và liệt kê quyết định quan trọng.")}>Tóm tắt cuộc họp</button></div></div> : chatLines.map((m, i) => <div className={`chat-message ${m.role}`} key={i}><b>{m.role === "user" ? "Bạn" : "Trợ lý AI"}</b><p>{m.content}</p></div>)}{aiBusy && <div className="chat-message assistant"><b>Trợ lý AI</b><p>Đang suy nghĩ...</p></div>}<div ref={chatEndRef}/></div><form className="chat-form" onSubmit={(e) => askAI(e)}><input value={aiQuestion} onChange={(e) => setAiQuestion(e.target.value)} placeholder="Nhập câu hỏi cho AI..."/><button disabled={aiBusy || !aiQuestion.trim()}>Gửi ↑</button></form><small className="muted">Không nhập mật khẩu, khóa API hoặc thông tin nhạy cảm vào khung chat.</small></section>}

        {tab === "reports" && <><div className="stats-grid"><Stat label="TỔNG CÔNG VIỆC" value={tasks.length} hint="Cả nhóm" icon="▦"/><Stat label="HOÀN THÀNH" value={completed} hint="Đã xong" icon="✓"/><Stat label="QUÁ HẠN" value={overdueTasks.length} hint="Cần xử lý" icon="!"/><Stat label="TIẾN ĐỘ" value={`${percent}%`} hint="Toàn nhóm" icon="↗"/></div><section className="panel full-panel"><div className="panel-heading"><div><h2>Khối lượng theo thành viên</h2><p>Số việc được giao và tỷ lệ hoàn thành.</p></div></div>{members.map((m) => { const assigned = tasks.filter((t) => t.assigned_to === m.user_id); const done = assigned.filter((t) => t.status === "done").length; const rate = assigned.length ? Math.round(done / assigned.length * 100) : 0; return <div className="report-member" key={m.id}><div><b>{m.display_name}</b><small>{done}/{assigned.length} công việc hoàn thành</small></div><div className="report-bar"><span style={{ width: `${rate}%` }}/></div><strong>{rate}%</strong></div>; })}{!members.length && <div className="empty-inline">Chưa có dữ liệu thành viên.</div>}</section></>}

        {tab === "notifications" && <section className="panel full-panel"><div className="panel-heading"><div><h2>Thông báo của bạn</h2><p>Thông báo khi có nhiệm vụ được giao.</p></div><span className="soft-tag">{unreadCount} chưa đọc</span></div>{notifications.map((n) => <div className={`notification-row ${n.read ? "read" : "unread"}`} key={n.id}><span className="notification-icon">♢</span><div><b>{n.message}</b><small>{new Date(n.created_at).toLocaleString("vi-VN")}</small></div>{!n.read && <button onClick={() => markNotificationRead(n)}>Đánh dấu đã đọc</button>}</div>)}{overdueTasks.length > 0 && <div className="notice warning-notice">Bạn đang có {overdueTasks.length} công việc quá hạn. Hãy mở mục Công việc để kiểm tra.</div>}{dueSoonTasks.length > 0 && <div className="notice">Có {dueSoonTasks.length} công việc đến hạn trong 48 giờ tới.</div>}{!notifications.length && !overdueTasks.length && !dueSoonTasks.length && <div className="empty-state"><div className="empty-icon">♢</div><h3>Chưa có thông báo mới</h3><p>Khi có nhiệm vụ được giao hoặc công việc gần đến hạn, thông tin sẽ xuất hiện ở đây.</p></div>}</section>}
        <footer className="footer">AI TeamWork <span>·</span> Dữ liệu nhóm được lưu trong Supabase</footer>
      </div>
    </section>
  </main>;
}

function pageDescription(tab: Tab) {
  const text: Record<Tab, string> = { overview: "", tasks: "Tạo, giao và theo dõi tiến độ nhiệm vụ.", members: "Mời thành viên bằng mã tham gia nhóm.", chat: "Trao đổi trực tiếp với các thành viên.", meetings: "Lên lịch, gọi video, ghi âm và lưu biên bản.", assistant: "Trợ lý AI hiểu dữ liệu công việc và cuộc họp của nhóm.", reports: "Theo dõi tiến độ và khối lượng công việc theo thành viên.", notifications: "Theo dõi nhiệm vụ được giao và việc quá hạn." };
  return text[tab];
}
function Stat({ label, value, hint, icon }: { label: string; value: string | number; hint: string; icon: string }) { return <div className="stat-card"><div className="stat-top"><span>{label}</span><i>{icon}</i></div><strong>{value}</strong><small>{hint}</small></div>; }
function TaskRows({ tasks, members, updateTask, deleteTask, openAttachment }: { tasks: Task[]; members: Member[]; updateTask: (task: Task, patch: Partial<Task>) => void; deleteTask: (id: string) => void; openAttachment: (task: Task) => void }) {
  if (!tasks.length) return <div className="empty-inline">Chưa có công việc trong danh sách này.</div>;
  return <div className="task-list">{tasks.map((task) => <article className="task-card" key={task.id}><div className="task-card-main"><div className="task-card-title"><b className={task.status === "done" ? "task-done" : ""}>{task.title}</b><span className={`priority-tag ${task.priority}`}>{task.priority === "high" ? "Cao" : task.priority === "low" ? "Thấp" : "Trung bình"}</span></div>{task.description && <p>{task.description}</p>}{task.attachment_path && <button className="attachment-link" onClick={() => openAttachment(task)}>📎 {task.attachment_name || "Mở tệp đính kèm"}</button>}<small>Phụ trách: {members.find((m) => m.user_id === task.assigned_to)?.display_name || "Chưa giao"} · Hạn: {task.due_date ? new Date(`${task.due_date}T00:00:00`).toLocaleDateString("vi-VN") : "Chưa đặt"}</small></div><div className="task-card-actions"><select aria-label="Người phụ trách" value={task.assigned_to || ""} onChange={(e) => updateTask(task, { assigned_to: e.target.value || null })}><option value="">Chưa giao</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}</select><select aria-label="Trạng thái công việc" value={task.status} onChange={(e) => updateTask(task, { status: e.target.value as Task["status"] })}><option value="todo">Chưa làm</option><option value="in_progress">Đang làm</option><option value="done">Hoàn thành</option></select><button className="edit-btn" onClick={() => { const title = window.prompt("Sửa tên công việc:", task.title); if (title?.trim()) updateTask(task, { title: title.trim() }); }}>Sửa</button><button className="delete-btn" onClick={() => deleteTask(task.id)} title="Xóa công việc">×</button></div></article>)}</div>;
}
function MemberRows({ members, isOwner, currentUserId, onRename, onRoleChange, onRemove }: { members: Member[]; isOwner?: boolean; currentUserId?: string; onRename?: (member: Member) => void; onRoleChange?: (member: Member, role: string) => void; onRemove?: (member: Member) => void }) {
  return <div className="member-list">
    {members.map((m) => <div className="member-row" key={m.id}>
      <div className="profile-avatar">{(m.display_name || "T").slice(0, 1).toUpperCase()}</div>
      <div><b>{m.display_name}</b><small>{m.email}</small></div>
      <span className="role-tag">{m.role === "owner" ? "Trưởng nhóm" : m.role === "admin" ? "Quản trị" : "Thành viên"}</span>
      {(isOwner || m.user_id === currentUserId) && <button className="edit-btn" onClick={() => onRename?.(m)}>Đổi tên</button>}
      {isOwner && m.role !== "owner" && <>
        <select className="role-select" value={m.role} onChange={(e) => onRoleChange?.(m, e.target.value)} aria-label={`Quyền của ${m.display_name}`}>
          <option value="member">Thành viên</option><option value="admin">Quản trị</option>
        </select>
        <button className="delete-btn" title="Xóa khỏi nhóm" onClick={() => onRemove?.(m)}>×</button>
      </>}
    </div>)}
    {!members.length && <div className="empty-inline">Chưa có thành viên.</div>}
  </div>;
}
