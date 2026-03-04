import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import { auth, db, googleProvider } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, onSnapshot, query, orderBy
} from "firebase/firestore";

// ── Constants ──────────────────────────────────────────────────────────────
const ACTIVITY_TYPES = [
  { id: "cardio",     label: "Cardio",     icon: "🏃", color: "#b85c38", bg: "#fdf0e8", goal: 2 },
  { id: "strength",   label: "Strength",   icon: "💪", color: "#3a6b8a", bg: "#e8f2f8", goal: 2 },
  { id: "stretching", label: "Stretching", icon: "🧘", color: "#4d7c5a", bg: "#eaf3ec", goal: 2 },
];

const ACTIVITY_OPTIONS = [
  "Ultimate", "Pickleball", "Bodyweight Exercises", "Hiking", "Weight Training",
  "Running", "Cycling", "Swimming", "HIIT", "Resistance Bands",
  "Kettlebell", "CrossFit", "Pilates", "Yoga", "Static Stretch",
  "Dynamic Stretch", "Foam Rolling", "Mobility Work", "Other",
];

const EMPTY_FORM = () => ({
  date: new Date().toISOString().split("T")[0],
  types: [], name: "", duration: "", notes: ""
});

// ── Helpers ────────────────────────────────────────────────────────────────
function getWeekKey(date) {
  // Always parse as local noon to avoid UTC timezone shift bugs
  const d = (typeof date === "string" && date.length === 10)
    ? new Date(date + "T12:00:00")
    : new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  // Format as YYYY-MM-DD in local time (not UTC)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function getWeekRange(weekKey, short = false) {
  const start = new Date(weekKey);
  const end = new Date(weekKey);
  end.setDate(end.getDate() + 6);
  if (short) return start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const fmt = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}
function getCurrentWeekKey() { return getWeekKey(new Date()); }
function formatDate(dateStr) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function getTypes(a) {
  if (Array.isArray(a.types) && a.types.length) return a.types;
  if (a.type) return [a.type];
  return [];
}

// ── Chart tooltip ──────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:"#fff", border:"1px solid #e8ddd0", borderRadius:10, padding:"10px 14px", boxShadow:"0 4px 16px #00000012", fontFamily:"'DM Sans',sans-serif", fontSize:12 }}>
      <p style={{ color:"#b0a090", marginBottom:6, fontWeight:500 }}>{label}</p>
      {payload.map(p => <p key={p.dataKey} style={{ color:p.color, marginBottom:2 }}>{p.name}: <strong>{p.value}</strong></p>)}
    </div>
  );
};

// ── CSS ────────────────────────────────────────────────────────────────────
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #faf8f4; font-family: 'DM Sans', sans-serif; }
  .display { font-family: 'Cormorant Garamond', Georgia, serif; }
  .sans    { font-family: 'DM Sans', sans-serif; }
  .card { background:#fff; border:1px solid #ede8df; border-radius:16px; box-shadow:0 2px 16px #c8a08810; }
  .tag  { display:inline-block; padding:2px 10px; border-radius:20px; font-size:10px; font-family:'DM Sans',sans-serif; font-weight:600; letter-spacing:0.3px; }

  input, select, textarea {
    background:#faf8f4; border:1.5px solid #ddd5c8; color:#2a1f14;
    border-radius:10px; padding:10px 14px; font-family:'DM Sans',sans-serif;
    font-size:13px; width:100%; outline:none; transition:border-color 0.15s, box-shadow 0.15s;
  }
  input:focus, select:focus, textarea:focus { border-color:#b85c38; box-shadow:0 0 0 3px #b85c3812; }
  select option { background:#fff; }
  textarea { resize:vertical; min-height:72px; }

  .btn-primary { cursor:pointer; border:none; border-radius:10px; font-family:'DM Sans',sans-serif; font-weight:600; font-size:13px; background:#2a1f14; color:#faf8f4; padding:12px 20px; transition:background 0.15s,transform 0.1s; width:100%; }
  .btn-primary:hover { background:#3d2f1e; transform:translateY(-1px); }

  .btn-google { cursor:pointer; border:1.5px solid #ddd5c8; border-radius:10px; font-family:'DM Sans',sans-serif; font-weight:600; font-size:14px; background:#fff; color:#2a1f14; padding:13px 28px; transition:all 0.15s; display:inline-flex; align-items:center; gap:10px; }
  .btn-google:hover { border-color:#b85c38; box-shadow:0 2px 12px #b85c3820; transform:translateY(-1px); }

  .btn-ghost  { cursor:pointer; border:1px solid #ddd5c8; border-radius:8px; font-family:'DM Sans',sans-serif; font-size:11px; background:transparent; color:#9a8a7a; padding:4px 10px; transition:all 0.15s; }
  .btn-ghost:hover  { border-color:#b85c38; color:#b85c38; }
  .btn-danger { cursor:pointer; border:1px solid #f0d8d0; border-radius:8px; font-family:'DM Sans',sans-serif; font-size:11px; background:transparent; color:#c07060; padding:4px 10px; transition:all 0.15s; }
  .btn-danger:hover { background:#fdf0ec; }

  .nav-btn { cursor:pointer; border:none; border-radius:8px; font-family:'DM Sans',sans-serif; font-size:12px; font-weight:500; padding:7px 13px; transition:all 0.15s; background:transparent; color:#9a8a7a; }
  .nav-btn.active { background:#2a1f14; color:#faf8f4; }
  .nav-btn:hover:not(.active) { color:#2a1f14; background:#f0ebe3; }

  .activity-row { transition:box-shadow 0.15s; }
  .activity-row:hover { box-shadow:0 4px 20px #c8a08820; }

  .ring-track { fill:none; stroke:#f0ebe3; }
  .ring-fill  { fill:none; stroke-linecap:round; transition:stroke-dashoffset 0.7s ease; }
  .progress-bar-bg { background:#f0ebe3; border-radius:99px; height:6px; overflow:hidden; }
  .progress-bar    { height:100%; border-radius:99px; transition:width 0.6s ease; }

  .range-btn { cursor:pointer; border:1.5px solid #ddd5c8; border-radius:8px; font-family:'DM Sans',sans-serif; font-size:11px; font-weight:500; padding:4px 11px; background:#fff; color:#9a8a7a; transition:all 0.15s; }
  .range-btn:hover  { border-color:#b85c38; color:#b85c38; }
  .range-btn.active { border-color:#b85c38; background:#fdf0e8; color:#b85c38; }

  .type-pill { cursor:pointer; display:inline-flex; align-items:center; gap:6px; padding:7px 14px; border-radius:99px; font-family:'DM Sans',sans-serif; font-size:13px; font-weight:500; border:2px solid #ddd5c8; background:#faf8f4; color:#9a8a7a; transition:all 0.15s; user-select:none; }
  .type-pill:hover { border-color:#b0a090; color:#5a4a3a; }
  .type-pill.selected-cardio     { border-color:#b85c38; background:#fdf0e8; color:#b85c38; }
  .type-pill.selected-strength   { border-color:#3a6b8a; background:#e8f2f8; color:#3a6b8a; }
  .type-pill.selected-stretching { border-color:#4d7c5a; background:#eaf3ec; color:#4d7c5a; }

  .divider { border:none; border-top:1px solid #ede8df; }
  .section-label { font-family:'DM Sans',sans-serif; font-size:10px; font-weight:600; letter-spacing:1.5px; text-transform:uppercase; color:#b0a090; margin-bottom:12px; }

  ::-webkit-scrollbar { width:4px; }
  ::-webkit-scrollbar-track { background:#f0ebe3; }
  ::-webkit-scrollbar-thumb { background:#ddd5c8; border-radius:4px; }

  .toast { position:fixed; bottom:28px; left:50%; transform:translateX(-50%); padding:11px 22px; border-radius:10px; font-family:'DM Sans',sans-serif; font-size:13px; font-weight:500; z-index:999; white-space:nowrap; animation:toastUp 0.3s ease; box-shadow:0 4px 20px #00000018; }
  @keyframes toastUp { from{opacity:0;transform:translateX(-50%) translateY(10px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }

  .fade-in { animation:fadeIn 0.25s ease; }
  @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }

  .spinner { width:32px; height:32px; border:3px solid #ede8df; border-top-color:#b85c38; border-radius:50%; animation:spin 0.8s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
`;

// ══════════════════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ══════════════════════════════════════════════════════════════════════════
function LoginScreen({ onLogin, loading }) {
  return (
    <div style={{ minHeight:"100vh", background:"#faf8f4", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ maxWidth:400, width:"100%", textAlign:"center" }}>
        <div style={{ fontSize:64, marginBottom:20 }}>🏃</div>
        <h1 className="display" style={{ fontSize:48, fontWeight:700, color:"#2a1f14", letterSpacing:"-1px", marginBottom:8 }}>FitLog</h1>
        <p className="sans" style={{ fontSize:14, color:"#b0a090", marginBottom:40, lineHeight:1.6 }}>
          Your personal fitness tracker.<br />Log activities, hit your goals, sync everywhere.
        </p>

        <div className="card" style={{ padding:32 }}>
          <p className="display" style={{ fontSize:20, fontWeight:600, fontStyle:"italic", color:"#2a1f14", marginBottom:8 }}>Welcome back</p>
          <p className="sans" style={{ fontSize:12, color:"#b0a090", marginBottom:24 }}>Sign in to access your fitness data across all your devices.</p>

          {loading ? (
            <div style={{ display:"flex", justifyContent:"center", padding:16 }}>
              <div className="spinner" />
            </div>
          ) : (
            <button className="btn-google" style={{ width:"100%", justifyContent:"center" }} onClick={onLogin}>
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
                <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/>
              </svg>
              Sign in with Google
            </button>
          )}
        </div>

        <p className="sans" style={{ fontSize:11, color:"#c0b0a0", marginTop:20 }}>
          Your data is private and only visible to you.
        </p>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════
export default function App() {
  const [user,        setUser]        = useState(undefined); // undefined = loading
  const [activities,  setActivities]  = useState([]);
  const [dbLoading,   setDbLoading]   = useState(false);
  const [view,        setView]        = useState("log");
  const [searchQuery, setSearchQuery] = useState("");
  const [showForm,    setShowForm]    = useState(false);
  const [chartRange,  setChartRange]  = useState(8);
  const [form,        setForm]        = useState(EMPTY_FORM());
  const [toast,       setToast]       = useState(null);
  const [editId,      setEditId]      = useState(null);
  const [authLoading, setAuthLoading] = useState(false);

  // ── Auth listener ──
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => setUser(u ?? null));
    return unsub;
  }, []);

  // ── Firestore listener — runs when user logs in ──
  useEffect(() => {
    if (!user) { setActivities([]); return; }
    setDbLoading(true);
    const q = query(
      collection(db, "users", user.uid, "activities"),
      orderBy("date", "desc")
    );
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setActivities(docs);
      setDbLoading(false);
    }, () => setDbLoading(false));
    return unsub;
  }, [user]);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ── Auth actions ──
  const handleLogin = async () => {
    setAuthLoading(true);
    try { await signInWithPopup(auth, googleProvider); }
    catch (e) { showToast("Sign-in failed. Please try again.", "error"); }
    finally { setAuthLoading(false); }
  };
  const handleLogout = async () => {
    await signOut(auth);
    setView("log");
  };

  // ── CRUD ──
  const toggleType = id => setForm(f => {
    const types = f.types.includes(id) ? f.types.filter(t => t !== id) : [...f.types, id];
    return { ...f, types };
  });

  const handleSubmit = async () => {
    if (!form.name || !form.duration || !form.date || !form.types.length) {
      showToast("Please fill all fields and pick at least one type", "error"); return;
    }
    try {
      const payload = {
        date:     form.date,
        types:    form.types,
        name:     form.name,
        duration: form.duration,
        notes:    form.notes || "",
        updatedAt: new Date().toISOString(),
      };
      if (editId) {
        await updateDoc(doc(db, "users", user.uid, "activities", editId), payload);
        showToast("Activity updated ✓");
        setEditId(null);
      } else {
        payload.createdAt = new Date().toISOString();
        await addDoc(collection(db, "users", user.uid, "activities"), payload);
        showToast("Activity logged!");
      }
      setForm(EMPTY_FORM());
      setShowForm(false);
    } catch (e) {
      showToast("Error saving. Please try again.", "error");
    }
  };

  const handleEdit = a => {
    setForm({ date: a.date, types: getTypes(a), name: a.name, duration: a.duration, notes: a.notes || "" });
    setEditId(a.id); setShowForm(true); setView("log");
  };

  const handleDelete = async id => {
    try {
      await deleteDoc(doc(db, "users", user.uid, "activities", id));
      showToast("Activity removed");
    } catch { showToast("Error deleting.", "error"); }
  };

  // ── Derived data ──
  const currentWeekKey = getCurrentWeekKey();

  const weekSummary = useMemo(() => {
    const weekActs = activities.filter(a => getWeekKey(a.date) === currentWeekKey);
    const s = {};
    ACTIVITY_TYPES.forEach(t => {
      const typed = weekActs.filter(a => getTypes(a).includes(t.id));
      s[t.id] = { count: typed.length, goal: t.goal, totalMin: typed.reduce((x, a) => x + parseInt(a.duration||0), 0), activities: typed };
    });
    return s;
  }, [activities, currentWeekKey]);

  const totalGoalsMet = ACTIVITY_TYPES.filter(t => weekSummary[t.id]?.count >= t.goal).length;

  const filteredHistory = useMemo(() => {
    const q = searchQuery.toLowerCase();
    if (!q) return activities;
    return activities.filter(a =>
      a.name.toLowerCase().includes(q) ||
      getTypes(a).join(" ").toLowerCase().includes(q) ||
      a.notes?.toLowerCase().includes(q) ||
      a.date.includes(q)
    );
  }, [activities, searchQuery]);

  const groupedHistory = useMemo(() => {
    const groups = {};
    filteredHistory.forEach(a => {
      const wk = getWeekKey(a.date);
      if (!groups[wk]) groups[wk] = [];
      groups[wk].push(a);
    });
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filteredHistory]);

  const chartData = useMemo(() => {
    const wm = {};
    activities.forEach(a => {
      const wk = getWeekKey(a.date);
      if (!wm[wk]) wm[wk] = { week:wk, label:getWeekRange(wk,true), cardio:0, strength:0, stretching:0, totalMin:0, goalsmet:0 };
      getTypes(a).forEach(tid => { wm[wk][tid] = (wm[wk][tid]||0) + 1; });
      wm[wk].totalMin += parseInt(a.duration||0);
    });
    Object.values(wm).forEach(w => { w.goalsmet = ACTIVITY_TYPES.filter(t => (w[t.id]||0) >= t.goal).length; });
    return Object.values(wm).sort((a,b) => a.week.localeCompare(b.week)).slice(-chartRange);
  }, [activities, chartRange]);

  const minutesChartData = useMemo(() => {
    const wm = {};
    activities.forEach(a => {
      const wk = getWeekKey(a.date);
      if (!wm[wk]) wm[wk] = { week:wk, label:getWeekRange(wk,true), cardio:0, strength:0, stretching:0 };
      getTypes(a).forEach(tid => { wm[wk][tid] = (wm[wk][tid]||0) + parseInt(a.duration||0); });
    });
    return Object.values(wm).sort((a,b) => a.week.localeCompare(b.week)).slice(-chartRange);
  }, [activities, chartRange]);

  const streak = useMemo(() => {
    const allWeeks = [...new Set(activities.map(a => getWeekKey(a.date)))].sort((a,b) => b.localeCompare(a));
    let count = 0;
    for (const wk of allWeeks) {
      const wa = activities.filter(a => getWeekKey(a.date) === wk);
      if (ACTIVITY_TYPES.filter(t => wa.filter(a => getTypes(a).includes(t.id)).length >= t.goal).length === 3) count++;
      else break;
    }
    return count;
  }, [activities]);

  const allTimeStats = useMemo(() => {
    const totalMin = activities.reduce((s,a) => s + parseInt(a.duration||0), 0);
    const allWeeks = [...new Set(activities.map(a => getWeekKey(a.date)))];
    const perfectWeeks = allWeeks.filter(wk => {
      const wa = activities.filter(a => getWeekKey(a.date) === wk);
      return ACTIVITY_TYPES.every(t => wa.filter(a => getTypes(a).includes(t.id)).length >= t.goal);
    }).length;
    return { totalMin, totalSessions: activities.length, perfectWeeks };
  }, [activities]);

  // ── Activity Row Component ──
  const ActivityRow = ({ a }) => {
    const types = getTypes(a).map(id => ACTIVITY_TYPES.find(t => t.id === id)).filter(Boolean);
    const primary = types[0] || ACTIVITY_TYPES[0];
    return (
      <div className="activity-row" style={{ background:"#fff", border:"1px solid #ede8df", borderRadius:14, padding:"16px 18px", marginBottom:10, display:"flex", alignItems:"center", gap:14 }}>
        <div style={{ width:48, height:48, borderRadius:12, background:primary.bg, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0 }}>
          {primary.icon}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5, flexWrap:"wrap" }}>
            <span className="display" style={{ fontSize:15, color:"#2a1f14", fontWeight:600 }}>{a.name}</span>
            {types.map(t => <span key={t.id} className="tag" style={{ background:t.bg, color:t.color }}>{t.label}</span>)}
          </div>
          <p className="sans" style={{ fontSize:11, color:"#b0a090" }}>
            {formatDate(a.date)} · {a.duration} min{a.notes ? ` · ${a.notes.slice(0,44)}${a.notes.length>44?"…":""}` : ""}
          </p>
        </div>
        <div style={{ display:"flex", gap:6, flexShrink:0 }}>
          <button className="btn-ghost" onClick={() => handleEdit(a)}>Edit</button>
          <button className="btn-danger" onClick={() => handleDelete(a.id)}>✕</button>
        </div>
      </div>
    );
  };

  // ── Render logic ──
  if (user === undefined) {
    return (
      <>
        <style>{GLOBAL_CSS}</style>
        <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"#faf8f4" }}>
          <div className="spinner" />
        </div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <style>{GLOBAL_CSS}</style>
        <LoginScreen onLogin={handleLogin} loading={authLoading} />
      </>
    );
  }

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div style={{ background:"#faf8f4", minHeight:"100vh", color:"#2a1f14" }}>

        {/* ── HEADER ── */}
        <header style={{ background:"#fff", borderBottom:"1px solid #ede8df", padding:"14px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:50, boxShadow:"0 2px 12px #c8a08808" }}>
          <div>
            <h1 className="display" style={{ fontSize:26, color:"#2a1f14", fontWeight:700, letterSpacing:"-0.3px", lineHeight:1 }}>FitLog</h1>
            <p className="sans" style={{ fontSize:10, color:"#c0b0a0", letterSpacing:1.5, marginTop:1, textTransform:"uppercase" }}>Personal Fitness Tracker</p>
          </div>
          <nav style={{ display:"flex", gap:4, alignItems:"center" }}>
            {[["log","📋 Log"],["week","📊 Week"],["charts","📈 Charts"],["history","🔍 History"]].map(([v,label]) => (
              <button key={v} className={`nav-btn ${view===v?"active":""}`} onClick={() => setView(v)}>{label}</button>
            ))}
            <div style={{ width:1, height:24, background:"#ede8df", margin:"0 8px" }} />
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              {user.photoURL && <img src={user.photoURL} alt="" style={{ width:28, height:28, borderRadius:"50%", border:"1.5px solid #ede8df" }} />}
              <button className="btn-ghost" onClick={handleLogout} style={{ fontSize:12 }}>Sign out</button>
            </div>
          </nav>
        </header>

        <main style={{ maxWidth:700, margin:"0 auto", padding:"28px 20px" }}>

          {/* Loading overlay */}
          {dbLoading && activities.length === 0 && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:80, gap:16 }}>
              <div className="spinner" />
              <p className="sans" style={{ fontSize:13, color:"#b0a090" }}>Loading your activities…</p>
            </div>
          )}

          {/* ════════ LOG ════════ */}
          {!dbLoading && view === "log" && (
            <div className="fade-in">
              {/* Week rings */}
              <div className="card" style={{ padding:"22px 26px", marginBottom:22, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div>
                  <p className="section-label" style={{ marginBottom:6 }}>This Week</p>
                  <h2 className="display" style={{ fontSize:22, fontWeight:600 }}>
                    {totalGoalsMet === 3 ? "Perfect week! 🏆" : `${totalGoalsMet} of 3 goals complete`}
                  </h2>
                  <p className="sans" style={{ fontSize:12, color:"#b0a090", marginTop:4 }}>
                    {totalGoalsMet === 3 ? "You're crushing it this week." : `${3-totalGoalsMet} goal${3-totalGoalsMet!==1?"s":""} remaining.`}
                  </p>
                </div>
                <div style={{ display:"flex", gap:16 }}>
                  {ACTIVITY_TYPES.map(t => {
                    const s = weekSummary[t.id];
                    const pct = Math.min(s.count / t.goal, 1);
                    const r = 26, circ = 2 * Math.PI * r;
                    return (
                      <div key={t.id} style={{ textAlign:"center" }}>
                        <svg width={64} height={64}>
                          <circle className="ring-track" cx={32} cy={32} r={r} strokeWidth={5} />
                          <circle className="ring-fill" cx={32} cy={32} r={r} strokeWidth={5} stroke={t.color}
                            strokeDasharray={circ} strokeDashoffset={circ*(1-pct)} transform="rotate(-90 32 32)" />
                          <text x="50%" y="50%" textAnchor="middle" dy="0.35em" fontSize={12} fill={t.color} fontFamily="DM Sans" fontWeight="600">{s.count}/{t.goal}</text>
                        </svg>
                        <p style={{ fontSize:20, marginTop:3 }}>{t.icon}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Log form */}
              {!showForm ? (
                <button className="btn-primary" style={{ marginBottom:24 }}
                  onClick={() => { setEditId(null); setForm(EMPTY_FORM()); setShowForm(true); }}>
                  + Log Activity
                </button>
              ) : (
                <div className="card fade-in" style={{ padding:26, marginBottom:26 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
                    <h3 className="display" style={{ fontSize:20, fontWeight:600, fontStyle:"italic" }}>{editId ? "Edit Activity" : "New Activity"}</h3>
                    <button className="btn-ghost" onClick={() => { setShowForm(false); setEditId(null); }}>Cancel</button>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
                    <div>
                      <label className="sans" style={{ fontSize:11, fontWeight:600, color:"#b0a090", display:"block", marginBottom:6, letterSpacing:0.5, textTransform:"uppercase" }}>Date *</label>
                      <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date:e.target.value }))} />
                    </div>
                    <div>
                      <label className="sans" style={{ fontSize:11, fontWeight:600, color:"#b0a090", display:"block", marginBottom:6, letterSpacing:0.5, textTransform:"uppercase" }}>Activity *</label>
                      <select value={form.name} onChange={e => setForm(f => ({ ...f, name:e.target.value }))}>
                        <option value="">Select…</option>
                        {ACTIVITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div style={{ gridColumn:"1/-1" }}>
                      <label className="sans" style={{ fontSize:11, fontWeight:600, color:"#b0a090", display:"block", marginBottom:10, letterSpacing:0.5, textTransform:"uppercase" }}>
                        Type * <span style={{ fontWeight:400, textTransform:"none", letterSpacing:0 }}>(pick all that apply)</span>
                      </label>
                      <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                        {ACTIVITY_TYPES.map(t => {
                          const sel = form.types.includes(t.id);
                          return (
                            <button key={t.id} type="button"
                              className={`type-pill ${sel ? `selected-${t.id}` : ""}`}
                              onClick={() => toggleType(t.id)}>
                              <span style={{ fontSize:20 }}>{t.icon}</span>
                              {t.label}
                              {sel && <span style={{ marginLeft:2, fontSize:12 }}>✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <label className="sans" style={{ fontSize:11, fontWeight:600, color:"#b0a090", display:"block", marginBottom:6, letterSpacing:0.5, textTransform:"uppercase" }}>Duration (min) *</label>
                      <input type="number" placeholder="45" min="1" max="300" value={form.duration} onChange={e => setForm(f => ({ ...f, duration:e.target.value }))} />
                    </div>
                    <div style={{ gridColumn:"1/-1" }}>
                      <label className="sans" style={{ fontSize:11, fontWeight:600, color:"#b0a090", display:"block", marginBottom:6, letterSpacing:0.5, textTransform:"uppercase" }}>Notes</label>
                      <textarea placeholder="How did it feel? Any personal bests?" value={form.notes} onChange={e => setForm(f => ({ ...f, notes:e.target.value }))} />
                    </div>
                  </div>
                  <button className="btn-primary" style={{ marginTop:18 }} onClick={handleSubmit}>{editId ? "Save Changes" : "Log Activity"}</button>
                </div>
              )}

              <p className="section-label">Recent Activities</p>
              {activities.length === 0 ? (
                <div className="card" style={{ padding:44, textAlign:"center" }}>
                  <p style={{ fontSize:40, marginBottom:10 }}>🌱</p>
                  <p className="display" style={{ fontSize:18, color:"#c0b0a0", fontStyle:"italic" }}>Nothing logged yet.</p>
                  <p className="sans" style={{ fontSize:12, color:"#c0b0a0", marginTop:6 }}>Start by logging your first activity above.</p>
                </div>
              ) : activities.slice(0,10).map(a => <ActivityRow key={a.id} a={a} />)}
            </div>
          )}

          {/* ════════ WEEK ════════ */}
          {!dbLoading && view === "week" && (
            <div className="fade-in">
              <div style={{ marginBottom:24 }}>
                <p className="section-label">Week of</p>
                <h2 className="display" style={{ fontSize:32, fontWeight:700, letterSpacing:"-0.5px" }}>{getWeekRange(currentWeekKey)}</h2>
              </div>
              <div className="card" style={{ padding:22, marginBottom:18, borderColor:totalGoalsMet===3?"#a8c8a0":"#ede8df" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div>
                    <p className="section-label">Weekly Status</p>
                    <p className="display" style={{ fontSize:24, fontWeight:600, fontStyle:totalGoalsMet===3?"italic":"normal" }}>
                      {totalGoalsMet===3?"Perfect week! 🏆":totalGoalsMet===2?"Almost there 💪":totalGoalsMet===1?"Getting started 🔥":"Let's go! 🌱"}
                    </p>
                  </div>
                  <div className="display" style={{ fontSize:44, color:"#b85c38", fontWeight:700, lineHeight:1 }}>
                    {totalGoalsMet}<span style={{ color:"#ddd5c8", fontSize:28 }}>/3</span>
                  </div>
                </div>
                <div className="progress-bar-bg" style={{ marginTop:16 }}>
                  <div className="progress-bar" style={{ width:`${(totalGoalsMet/3)*100}%`, background:"linear-gradient(90deg,#b85c38,#4d7c5a)" }} />
                </div>
              </div>
              {ACTIVITY_TYPES.map(t => {
                const s = weekSummary[t.id]; const met = s.count >= t.goal;
                return (
                  <div key={t.id} className="card" style={{ padding:22, marginBottom:14, borderColor:met?t.color+"55":"#ede8df" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                        <div style={{ width:52, height:52, borderRadius:14, background:t.bg, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26 }}>{t.icon}</div>
                        <div>
                          <h3 className="display" style={{ fontSize:20, fontWeight:600 }}>{t.label}</h3>
                          <p className="sans" style={{ fontSize:11, color:"#b0a090", marginTop:2 }}>{s.totalMin} min total this week</p>
                        </div>
                      </div>
                      <span className="tag" style={{ background:met?t.bg:"#f5f0ea", color:met?t.color:"#b0a090", fontSize:11, padding:"4px 12px" }}>
                        {met ? "✓ Goal met" : `${s.count} / ${t.goal} sessions`}
                      </span>
                    </div>
                    <div className="progress-bar-bg">
                      <div className="progress-bar" style={{ width:`${Math.min(s.count/t.goal,1)*100}%`, background:t.color }} />
                    </div>
                    {s.activities.length > 0 && (
                      <div style={{ marginTop:14 }}>
                        <hr className="divider" style={{ marginBottom:12 }} />
                        {s.activities.map(a => (
                          <div key={a.id} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0" }}>
                            <span className="sans" style={{ fontSize:13, color:"#3a2a1a", fontWeight:500 }}>{a.name}</span>
                            <span className="sans" style={{ fontSize:11, color:"#b0a090" }}>{formatDate(a.date)} · {a.duration} min</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="card" style={{ padding:22 }}>
                <p className="section-label">Weekly Totals</p>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr" }}>
                  {[
                    ["Sessions", Object.values(weekSummary).reduce((s,v)=>s+v.count,0)],
                    ["Minutes",  Object.values(weekSummary).reduce((s,v)=>s+v.totalMin,0)],
                    ["Goals Met",`${totalGoalsMet} / 3`],
                  ].map(([label,val],i) => (
                    <div key={label} style={{ textAlign:"center", padding:"0 8px", borderRight:i<2?"1px solid #ede8df":"none" }}>
                      <p className="display" style={{ fontSize:34, color:"#b85c38", fontWeight:700, lineHeight:1 }}>{val}</p>
                      <p className="sans" style={{ fontSize:11, color:"#b0a090", marginTop:4 }}>{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ════════ CHARTS ════════ */}
          {!dbLoading && view === "charts" && (
            <div className="fade-in">
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:24 }}>
                <div>
                  <p className="section-label">Progress Over Time</p>
                  <h2 className="display" style={{ fontSize:32, fontWeight:700, letterSpacing:"-0.5px" }}>Your Trends</h2>
                </div>
                <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                  <span className="sans" style={{ fontSize:11, color:"#b0a090", marginRight:2 }}>Show:</span>
                  {[4,8,12,24].map(w => (
                    <button key={w} className={`range-btn ${chartRange===w?"active":""}`} onClick={() => setChartRange(w)}>{w}w</button>
                  ))}
                </div>
              </div>
              {chartData.length === 0 ? (
                <div className="card" style={{ padding:60, textAlign:"center" }}>
                  <p style={{ fontSize:48, marginBottom:12 }}>📈</p>
                  <p className="display" style={{ fontSize:20, color:"#c0b0a0", fontStyle:"italic" }}>No data to chart yet.</p>
                  <p className="sans" style={{ fontSize:12, color:"#c0b0a0", marginTop:6 }}>Log some activities and your trends will appear here.</p>
                </div>
              ) : (
                <>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:12, marginBottom:20 }}>
                    {[
                      ["🔥","Streak",      streak===0?"—":`${streak}wk`,"#b85c38"],
                      ["⏱","Total Hours", `${Math.round(allTimeStats.totalMin/60)}h`,"#3a6b8a"],
                      ["🏆","Perfect Wks", allTimeStats.perfectWeeks,"#4d7c5a"],
                      ["📋","Sessions",    allTimeStats.totalSessions,"#7a5a3a"],
                    ].map(([icon,label,val,color]) => (
                      <div key={label} className="card" style={{ padding:"18px 12px", textAlign:"center" }}>
                        <p style={{ fontSize:28, marginBottom:8 }}>{icon}</p>
                        <p className="display" style={{ fontSize:26, color, fontWeight:700, lineHeight:1 }}>{val}</p>
                        <p className="sans" style={{ fontSize:10, color:"#b0a090", marginTop:5, fontWeight:500, letterSpacing:0.5, textTransform:"uppercase" }}>{label}</p>
                      </div>
                    ))}
                  </div>
                  {[
                    { title:"Sessions per Week", sub:"Activity breakdown by type", height:220,
                      chart: <BarChart data={chartData} barSize={22} margin={{top:4,right:4,left:-20,bottom:0}}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0ebe3" />
                        <XAxis dataKey="label" tick={{fill:"#b0a090",fontSize:10,fontFamily:"DM Sans"}} axisLine={false} tickLine={false} />
                        <YAxis tick={{fill:"#b0a090",fontSize:10,fontFamily:"DM Sans"}} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip content={<ChartTooltip />} cursor={{fill:"#b85c3808"}} />
                        <Legend wrapperStyle={{fontFamily:"DM Sans",fontSize:11,paddingTop:12}} />
                        <Bar dataKey="cardio" name="Cardio" stackId="a" fill="#b85c38" />
                        <Bar dataKey="strength" name="Strength" stackId="a" fill="#3a6b8a" />
                        <Bar dataKey="stretching" name="Stretching" stackId="a" fill="#4d7c5a" radius={[4,4,0,0]} />
                      </BarChart> },
                    { title:"Goals Met per Week", sub:"Consistency over time", height:200,
                      chart: <LineChart data={chartData} margin={{top:4,right:4,left:-20,bottom:0}}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0ebe3" />
                        <XAxis dataKey="label" tick={{fill:"#b0a090",fontSize:10,fontFamily:"DM Sans"}} axisLine={false} tickLine={false} />
                        <YAxis tick={{fill:"#b0a090",fontSize:10,fontFamily:"DM Sans"}} axisLine={false} tickLine={false} domain={[0,3]} ticks={[0,1,2,3]} />
                        <Tooltip content={<ChartTooltip />} cursor={{stroke:"#ede8df"}} />
                        <ReferenceLine y={3} stroke="#4d7c5a44" strokeDasharray="5 4" label={{value:"Perfect week",fill:"#4d7c5a",fontSize:9,fontFamily:"DM Sans"}} />
                        <Line type="monotone" dataKey="goalsmet" name="Goals Met" stroke="#b85c38" strokeWidth={2.5} dot={{fill:"#b85c38",r:4,strokeWidth:0}} activeDot={{r:6,stroke:"#b85c3833",strokeWidth:4}} />
                      </LineChart> },
                    { title:"Minutes per Week", sub:"Time invested per category", height:220,
                      chart: <BarChart data={minutesChartData} barSize={14} margin={{top:4,right:4,left:-10,bottom:0}}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0ebe3" />
                        <XAxis dataKey="label" tick={{fill:"#b0a090",fontSize:10,fontFamily:"DM Sans"}} axisLine={false} tickLine={false} />
                        <YAxis tick={{fill:"#b0a090",fontSize:10,fontFamily:"DM Sans"}} axisLine={false} tickLine={false} unit="m" />
                        <Tooltip content={<ChartTooltip />} cursor={{fill:"#b85c3808"}} />
                        <Legend wrapperStyle={{fontFamily:"DM Sans",fontSize:11,paddingTop:12}} />
                        <Bar dataKey="cardio" name="Cardio" fill="#b85c38" radius={[4,4,0,0]} />
                        <Bar dataKey="strength" name="Strength" fill="#3a6b8a" radius={[4,4,0,0]} />
                        <Bar dataKey="stretching" name="Stretching" fill="#4d7c5a" radius={[4,4,0,0]} />
                      </BarChart> },
                    { title:"Session Trends by Type", sub:"Each category vs. your goal of 2", height:220,
                      chart: <LineChart data={chartData} margin={{top:4,right:4,left:-20,bottom:0}}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0ebe3" />
                        <XAxis dataKey="label" tick={{fill:"#b0a090",fontSize:10,fontFamily:"DM Sans"}} axisLine={false} tickLine={false} />
                        <YAxis tick={{fill:"#b0a090",fontSize:10,fontFamily:"DM Sans"}} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip content={<ChartTooltip />} cursor={{stroke:"#ede8df"}} />
                        <ReferenceLine y={2} stroke="#c0b0a044" strokeDasharray="5 4" label={{value:"goal",fill:"#c0b0a0",fontSize:9,fontFamily:"DM Sans"}} />
                        <Legend wrapperStyle={{fontFamily:"DM Sans",fontSize:11,paddingTop:12}} />
                        {ACTIVITY_TYPES.map(t => (
                          <Line key={t.id} type="monotone" dataKey={t.id} name={t.label} stroke={t.color} strokeWidth={2} dot={{fill:t.color,r:3,strokeWidth:0}} activeDot={{r:5,stroke:t.color+"33",strokeWidth:4}} />
                        ))}
                      </LineChart> },
                  ].map(({ title, sub, height, chart }, i) => (
                    <div key={title} className="card" style={{ padding:22, marginBottom: i < 3 ? 16 : 0 }}>
                      <p className="section-label">{title}</p>
                      <p className="display" style={{ fontSize:18, fontWeight:600, marginBottom:18 }}>{sub}</p>
                      <ResponsiveContainer width="100%" height={height}>{chart}</ResponsiveContainer>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* ════════ HISTORY ════════ */}
          {!dbLoading && view === "history" && (
            <div className="fade-in">
              <div style={{ marginBottom:20 }}>
                <input type="text" placeholder="Search by activity, type, notes, or date…"
                  value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  style={{ fontSize:13, padding:"12px 16px" }} />
              </div>
              {groupedHistory.length === 0 ? (
                <div className="card" style={{ padding:48, textAlign:"center" }}>
                  <p className="display" style={{ fontSize:20, color:"#c0b0a0", fontStyle:"italic" }}>
                    {searchQuery ? "No results found." : "No history yet."}
                  </p>
                </div>
              ) : groupedHistory.map(([wk, acts]) => {
                const wkActs = activities.filter(a => getWeekKey(a.date) === wk);
                const wkGoalsMet = ACTIVITY_TYPES.filter(t => wkActs.filter(a => getTypes(a).includes(t.id)).length >= t.goal).length;
                return (
                  <div key={wk} style={{ marginBottom:28 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                      <h3 className="display" style={{ fontSize:16, fontWeight:600, color:"#7a6a5a" }}>{getWeekRange(wk)}</h3>
                      <span className="tag" style={{ background:wkGoalsMet===3?"#eaf3ec":"#f5f0ea", color:wkGoalsMet===3?"#4d7c5a":"#b0a090", fontSize:11, padding:"4px 12px" }}>
                        {wkGoalsMet===3 ? "🏆 Perfect Week" : `${wkGoalsMet}/3 goals`}
                      </span>
                    </div>
                    {acts.map(a => <ActivityRow key={a.id} a={a} />)}
                  </div>
                );
              })}
            </div>
          )}
        </main>

        {toast && (
          <div className="toast" style={{ background:toast.type==="error"?"#fdf0ec":"#fff", color:toast.type==="error"?"#b85c38":"#4d7c5a", border:`1px solid ${toast.type==="error"?"#f0d0c0":"#c0d8c0"}` }}>
            {toast.msg}
          </div>
        )}
      </div>
    </>
  );
}
