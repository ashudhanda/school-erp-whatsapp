// Photo-to-marks extraction: a teacher photographs a handwritten mark sheet
// and the configured vision provider returns structured rows. Two gates run
// BEFORE any AI is called, and they are deliberately in this order:
//   1. Privacy gate — a school must explicitly opt in (vision_allowed), because
//      this ships student marks to a third-party AI provider.
//   2. Budget gate — each school has a daily call allowance (ai_daily_budget),
//      enforced with an atomic INSERT ... ON CONFLICT ... WHERE calls<? so
//      concurrent calls from the same school can't overspend the budget.
// The AI result is then validated defensively: entries must be an array of at
// most 1000 rows, and every entry is flagged `uncertain` unless the model
// explicitly said otherwise — teachers must confirm unsure rows.
import { UserError, schoolConfig, run } from './services.js';
import { todayIST } from './db.js';

// Test seam for the scripts/test.js suite: only settable when NODE_ENV=test.
let testExtractor=null;
export function setVisionTest(fn) { if(process.env.NODE_ENV!=='test') throw new Error('Test extraction disabled');testExtractor=fn; }

/**
 * Extract test marks from a photo of a mark sheet via the vision provider.
 * Requires school opt-in and remaining daily AI budget; every uncertain
 * entry is flagged for teacher confirmation.
 * @param {number} schoolId - the school the marks belong to
 * @param {Buffer} buffer - the photo bytes (JPEG or PNG)
 * @param {string} mime - MIME type of the photo
 * @returns {Promise<{name: string|null, total: number|null, entries: {roll_no: string, name: string, marks: number, uncertain: boolean}[]}>}
 * @throws {UserError} when vision is not approved, the daily budget is spent, or the photo can't be read reliably
 */
export async function extractMarks(schoolId,buffer,mime) {
  const school=await schoolConfig(schoolId);
  // Privacy gate: never send student marks to an AI provider without the school's opt-in.
  if(!school.options.vision_allowed) throw new UserError('Photo extraction needs school approval for sending student mark sheets to the configured AI provider. Text entry is available.');
  if(testExtractor)return testExtractor(buffer,mime);
  const { callVision }=await import('./ai/visionPool.js');
  // Budget gate: clamp the school's configured budget to [0, 1000] and claim one
  // call atomically — the WHERE clause rejects the INSERT once the limit is hit.
  const limit=Math.max(0,Math.min(1000,Number(school.options.ai_daily_budget??200)));
  if(!limit)throw new UserError('Photo AI is disabled. Please use text entry.');
  const used=await run(`INSERT INTO ai_usage(school_id,day,calls) VALUES(?,?,1) ON CONFLICT(school_id,day)
    DO UPDATE SET calls=calls+1 WHERE calls<? RETURNING calls`,[schoolId,todayIST(),limit]);
  if(!limit||!used.rows.length)throw new UserError('The daily AI allowance is reached. Please use text entry.');
  const response=await callVision(buffer,mime);
  if(!response)throw new UserError('No approved vision provider is available. Please type the marks instead.');
  let obj;
  // The model may wrap JSON in ```json fences; strip them before parsing.
  try {obj=JSON.parse(response.replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{throw new UserError('The image could not be read reliably. Send a clearer photo or type the marks.');}
  if(!Array.isArray(obj.entries)||obj.entries.length>1000)throw new UserError('Unreliable photo result. Use text entry.');
  // Default `uncertain` to true unless the model explicitly marked false — an
  // unmarked row must never be trusted silently.
  return {name:typeof obj.test_name==='string'?obj.test_name:null,total:typeof obj.total_marks==='number'?obj.total_marks:null,entries:obj.entries.map(e=>({roll_no:e.roll_no,name:e.name||'',marks:e.marks,uncertain:e.uncertain!==false}))};
}
