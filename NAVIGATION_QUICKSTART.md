# 🚀 ORBIT Navigation - Quick Start Guide

## ✅ Status Check

**Files Verified:**
- ✅ Layout.tsx exists
- ✅ Breadcrumbs.tsx exists
- ✅ Navbar.tsx exists
- ✅ Sidebar.tsx exists
- ✅ All pages import Layout correctly

**Issue Identified:**
❌ Next.js server has permission errors on `.next` directory

---

## 🎯 One-Command Fix

Open your terminal and run:

```bash
cd /home/igorhaf/orbit-2.1/frontend
./fix-and-start.sh
```

**That's it!** The script will:
1. Kill any old Next.js processes
2. Clean the `.next` cache (asking for sudo if needed)
3. Verify dependencies are installed
4. Start Next.js fresh

---

## 📺 What You Should See

### Terminal Output:
```
🧹 ORBIT Navigation Fix & Start Script
=======================================

1️⃣ Killing any running Next.js processes...
2️⃣ Cleaning cache directories...
   ✅ Cache cleaned!

3️⃣ Checking dependencies...
   ✅ Dependencies already installed

4️⃣ Starting Next.js dev server...
   🚀 Server will start on http://localhost:3000

=======================================

▲ Next.js 14.2.35
- Local:        http://localhost:3000
- Environments: .env.local

✓ Starting...
✓ Ready in 3.2s
○ Compiling / ...
✓ Compiled / in 2.1s
```

### Browser at http://localhost:3000:

```
┌─────────────────────────────────────────────────┐
│  🔵 ORBIT                [Home] [Projects] ...  │ ← Navbar
├─────────────────────────────────────────────────┤
│  Home > Dashboard                               │ ← Breadcrumbs
├─────────────────────────────────────────────────┤
│                                                 │
│  📊 Dashboard Statistics                        │
│  [Total Projects] [Active Tasks] [Completed]   │
│                                                 │
│  🎯 Quick Actions                              │
│  [Manage Projects] [Kanban] [Interviews]       │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## 🧪 Verification Steps

After the server starts, verify:

### 1. Visual Check
- ✅ White navbar at top with blue "O" logo
- ✅ "ORBIT" text next to logo
- ✅ Navigation links: Home, Projects, Kanban, Interviews
- ✅ Current page highlighted in blue
- ✅ Breadcrumbs below navbar (except on home page)

### 2. Navigation Test
Click each link and verify it works:
- [ ] Home → goes to `/`
- [ ] Projects → goes to `/projects`
- [ ] Kanban → goes to `/kanban`
- [ ] Interviews → goes to `/interviews`

### 3. Browser Console (F12)
- ✅ No red errors
- ✅ Only blue info logs from API calls
- ✅ No "Module not found" errors

---

## 🆘 If Script Asks for Password

When you see:
```
⚠️  Some files need sudo permissions...
Please enter your password when prompted:
```

**This is normal!** Just enter your user password.

This happens because Docker/previous runs created files owned by root.

---

## 🔧 Alternative: Manual Steps

If the script doesn't work, run each step manually:

```bash
cd /home/igorhaf/orbit-2.1/frontend

# 1. Kill processes
pkill -f "next dev"

# 2. Clean cache (enter password when prompted)
sudo rm -rf .next
rm -rf node_modules/.cache
rm -rf .turbo

# 3. Start server
npm run dev
```

---

## ❓ Troubleshooting

### Issue: Port 3000 in use

**Solution:** Server will automatically try port 3001:
```
⚠ Port 3000 is in use, trying 3001 instead.
- Local: http://localhost:3001
```

Just open `http://localhost:3001` instead.

### Issue: "Module not found: lucide-react"

**Solution:**
```bash
npm install lucide-react
```

### Issue: Navigation shows but no styling

**Solution:** Check Tailwind is working:
```bash
# Restart dev server
# Tailwind should auto-compile
```

### Issue: Still shows old page

**Solution:** Hard refresh browser:
- Windows/Linux: `Ctrl + Shift + R`
- Mac: `Cmd + Shift + R`

---

## 📸 Expected Result Screenshots

### Home Page
```
┌────────────────────────────────────────┐
│ 🔵 ORBIT    [Home] [Projects] [Kanban]│
├────────────────────────────────────────┤
│                                        │
│      Welcome to ORBIT                  │
│   Intelligent Code Generation          │
│                                        │
│   [New Project] [View Projects]        │
│                                        │
│   📊 Stats:                           │
│   [3 Projects] [5 Active] [12 Done]   │
│                                        │
└────────────────────────────────────────┘
```

### Projects Page
```
┌────────────────────────────────────────┐
│ 🔵 ORBIT    [Home] [Projects] [Kanban]│
├────────────────────────────────────────┤
│ Home > Projects                        │ ← Breadcrumbs!
├────────────────────────────────────────┤
│                                        │
│   Projects                             │
│   [New Project]                        │
│                                        │
│   [Project 1] [Project 2] [Project 3] │
│                                        │
└────────────────────────────────────────┘
```

---

## ✅ Success Criteria

You'll know it's working when:

1. ✅ Server starts without errors
2. ✅ Browser shows navbar with ORBIT logo
3. ✅ Navigation links are clickable and work
4. ✅ Breadcrumbs appear on non-home pages
5. ✅ Page styling looks good (Tailwind working)
6. ✅ No console errors (F12)

---

## 🎉 Next Steps

Once navigation is working:

1. ✅ Test all pages work
2. ✅ Create your first project
3. ✅ Try the Kanban board
4. ✅ Start an interview session

---

**Need help?** Share:
- Terminal output from the script
- Browser console errors (F12)
- Screenshots of what you see

Good luck! 🚀
