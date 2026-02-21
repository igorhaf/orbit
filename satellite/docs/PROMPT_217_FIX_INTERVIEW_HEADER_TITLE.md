# PROMPT #217 - Fix Interview Header Using Project Title Instead of Card Title
## Card-focused interviews now correctly show card context, not project name

**Date:** February 9, 2026
**Status:** ✅ COMPLETED
**Priority:** MEDIUM
**Type:** Bug Fix
**Impact:** Card-focused interviews now start with the correct fixed questions (Q1: motivation type with parent card context) instead of AI-generated questions referencing the project name

---

## 🎯 Objective

Fix the bug where card-focused interviews were showing the project title in the interview header/first question instead of the card title.

**Problem:**
- Card-focused interviews are for creating cards within a parent card (e.g., creating a Story under an Epic)
- The `generate_first_question()` function only had a special case for `context` interviews
- For `card_focused` mode, it fell through to the generic code that generates an AI first question using `project.name`
- Similarly, `handle_unified_open_interview()` didn't handle Q2/Q3 fixed questions for card_focused mode
- Result: The first question greeted the user with "projeto X" instead of showing the card-focused Q1 (motivation type selection with parent card context)

**Root Cause:**
- `generate_first_question()` in `unified_open_handler.py` lacked a `card_focused` handler, so it used the generic AI-generated first question with `project.name`
- `handle_unified_open_interview()` lacked a `card_focused` handler for Q2-Q3 fixed questions

**Key Requirements:**
1. Card-focused interviews must start with Q1 (motivation type) showing parent card context
2. Q2 (title) and Q3 (description) must use fixed questions, not AI-generated ones
3. Q4+ continues to use AI contextual questions via `build_card_focused_prompt`

---

## ✅ What Was Implemented

### 1. Added card_focused handler in `generate_first_question()`

Added a check for `interview.interview_mode == "card_focused"` that returns the fixed Q1 from `get_card_focused_fixed_question()`. This shows the motivation type selector with parent card context ("Card pai: Epic Name (epic)") instead of an AI-generated question with the project name.

### 2. Added card_focused handler in `handle_unified_open_interview()`

Added an `elif` branch for `card_focused` mode that:
- Returns fixed Q2 (title) and Q3 (description) during the fixed question phase
- Stores the motivation type from Q1 answer
- Falls through to AI contextual questions (via `build_unified_open_prompt` → `build_card_focused_prompt`) for Q4+

---

## 📁 Files Modified

1. **backend/app/api/routes/interviews/unified_open_handler.py** - Added card_focused handlers in both `generate_first_question()` and `handle_unified_open_interview()`

---

## 🧪 Testing Results

```
✅ Python syntax check passed
✅ Card-focused Q1 shows motivation type with parent card context
✅ Card-focused Q2/Q3 use fixed questions (title, description)
✅ Card-focused Q4+ uses AI contextual questions
✅ Context interviews unaffected
✅ Other interview modes unaffected
```

---

## 🎯 Success Metrics

✅ **Correct first question**: Card-focused interviews start with Q1 (motivation type) showing parent card title
✅ **Fixed questions flow**: Q1-Q3 all use fixed questions from card_focused_questions.py
✅ **No project name in header**: Interview context references the card, not the project

---

## 🎉 Status: COMPLETE

Card-focused interviews now correctly use the fixed question flow (Q1: motivation type, Q2: title, Q3: description) with parent card context, instead of generating AI questions that reference the project name.

**Key Achievements:**
- ✅ Fixed first question showing project name instead of card context
- ✅ Added card_focused Q1-Q3 fixed question handling in unified handler
- ✅ Maintains backward compatibility with all other interview modes

---
