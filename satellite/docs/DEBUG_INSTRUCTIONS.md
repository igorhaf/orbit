# ORBIT Debug & Testing Instructions

## ✅ What Was Fixed

1. **Debug Page Created** (`/debug`)
   - Comprehensive connection testing
   - Shows current configuration
   - Tests 4 critical endpoints
   - Provides clear diagnosis

2. **CORS Configuration** (Backend)
   - Already configured correctly in `backend/app/config.py`
   - Allows `http://localhost:3000` and `http://127.0.0.1:3000`

3. **Improved API Client** (`frontend/src/lib/api.ts`)
   - Switched from axios to fetch
   - Comprehensive logging (📡, ✅, ❌ icons)
   - Better error messages
   - Network failure detection

4. **Environment Variables** (`.env.local`)
   - Already configured: `NEXT_PUBLIC_API_URL=http://localhost:8000`

5. **HomePage Error Handling** (`frontend/src/app/page.tsx`)
   - Shows clear error message when backend is unreachable
   - Quick fix checklist
   - Retry button
   - Link to debug console

---

## 🧪 Testing Steps

### Step 1: Start Backend

```bash
cd /home/igorhaf/orbit-2.1/backend
uvicorn app.main:app --reload
```

**Expected output:**
```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

### Step 2: Verify Backend Health

```bash
curl http://localhost:8000/health
```

**Expected output:**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "environment": "development",
  "app_name": "AI Orchestrator API"
}
```

### Step 3: Start Frontend

**In a new terminal:**

```bash
cd /home/igorhaf/orbit-2.1/frontend
npm run dev
```

**Expected output:**
```
> frontend@0.1.0 dev
> next dev

  ▲ Next.js 14.x.x
  - Local:        http://localhost:3000

 ✓ Ready in 2.3s
```

### Step 4: Open Debug Console

Navigate to: **http://localhost:3000/debug**

Click **"Run All Tests"**

**Expected results:**
- ✅ 1. API Base URL - OK
- ✅ 2. Health Check - OK
- ✅ 3. Projects Endpoint - OK
- ✅ 4. CORS Check - OK

**If all tests pass:**
- Green success message: "All tests passed!"
- Backend is running and accessible

**If tests fail:**
- Red error message with specific issues
- Check which test failed to identify the problem

### Step 5: Open Homepage

Navigate to: **http://localhost:3000**

**Expected behavior:**

**If backend is running:**
- Shows "Loading dashboard..."
- Then shows dashboard with stats

**If backend is NOT running:**
- Shows error card with:
  - "Failed to Connect to Backend"
  - Error message
  - Quick Fix Checklist
  - "Retry Connection" button
  - "Open Debug Console" button

---

## 🐛 Common Issues & Solutions

### Issue 1: "Failed to fetch" Error

**Problem:** Backend is not running

**Solution:**
```bash
cd backend
uvicorn app.main:app --reload
```

### Issue 2: "CORS" Error

**Problem:** CORS not configured correctly

**Solution:**
1. Check `backend/app/config.py` line 38-41
2. Verify it allows `http://localhost:3000`
3. Restart backend

### Issue 3: Wrong API URL

**Problem:** Frontend connecting to wrong backend

**Solution:**
1. Check `frontend/.env.local` exists
2. Verify it contains: `NEXT_PUBLIC_API_URL=http://localhost:8000`
3. Restart frontend (important!)

### Issue 4: Port Already in Use

**Backend (8000):**
```bash
lsof -ti:8000 | xargs kill -9
```

**Frontend (3000):**
```bash
lsof -ti:3000 | xargs kill -9
```

---

## 📋 Debugging Checklist

Use this checklist if you encounter loading issues:

- [ ] Backend is running on port 8000
- [ ] Backend health endpoint responds: `curl http://localhost:8000/health`
- [ ] Frontend `.env.local` exists and is correct
- [ ] Frontend has been restarted after `.env.local` changes
- [ ] No firewall blocking ports 3000 or 8000
- [ ] Browser console shows API logs (📡, ✅, ❌)
- [ ] Debug page (`/debug`) tests all pass

---

## 🔍 Browser Console Logs

Open browser DevTools (F12) → Console tab

**Successful load:**
```
🔧 ORBIT API Client initialized
📍 API URL: http://localhost:8000
🔍 Loading dashboard data...
📡 API Request: { method: 'GET', url: 'http://localhost:8000/api/v1/projects/', ... }
📥 API Response: { status: 200, ok: true, ... }
✅ API Success
✅ Dashboard data loaded
```

**Failed load:**
```
🔧 ORBIT API Client initialized
📍 API URL: http://localhost:8000
🔍 Loading dashboard data...
📡 API Request: { method: 'GET', url: 'http://localhost:8000/api/v1/projects/', ... }
❌ API Request Failed: { url: '...', error: 'Failed to fetch' }
❌ Failed to load dashboard: Cannot connect to backend at http://localhost:8000...
```

---

## ✅ Success Criteria

You've successfully fixed the issue when:

1. ✅ Debug page shows all tests passing
2. ✅ Homepage loads without infinite loading
3. ✅ Dashboard shows project statistics
4. ✅ Browser console shows ✅ API Success logs
5. ✅ No errors in browser console
6. ✅ No errors in backend terminal

---

## 📞 Still Having Issues?

If you've followed all steps and still have issues:

1. Check backend logs in the terminal running `uvicorn`
2. Check browser console for JavaScript errors
3. Run debug tests and screenshot results
4. Check if database is running (PostgreSQL)
5. Verify all environment variables are set

---

## 🎯 Quick Test Command

**One-line test:**
```bash
curl http://localhost:8000/health && echo "✅ Backend OK" || echo "❌ Backend FAILED"
```

**Expected:** `✅ Backend OK`

---

## 📝 Files Modified

1. `frontend/src/app/debug/page.tsx` - New debug page
2. `frontend/src/lib/api.ts` - Improved with better error handling
3. `frontend/src/app/page.tsx` - Added error handling and retry
4. `frontend/.env.local` - Already configured (no changes needed)
5. `backend/app/main.py` - CORS already configured (no changes needed)
6. `backend/app/config.py` - CORS origins already set (no changes needed)

---

**Last Updated:** December 27, 2024
**Status:** All debugging features implemented and tested
