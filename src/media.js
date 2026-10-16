// Media helpers: downloading attachments parents/teachers send through the
// WhatsApp Cloud API, and uploading school documents (receipts, mark sheets)
// back to WhatsApp. Everything here is defensive — WhatsApp metadata is
// treated as untrusted, so file type is sniffed from magic bytes AFTER the
// download instead of trusting the declared Content-Type.
import { API } from './whatsapp.js';
import { config } from './config.js';
import { UserError } from './services.js';

// Maximum attachment size anywhere in the product (1 MiB). Enforced twice:
// against the declared Content-Length header, and while streaming the body.
export const MEDIA_LIMIT=1024*1024;

/**
 * Detect a file's real type from its magic bytes — never from its extension
 * or declared Content-Type. PDFs are identified by the "%PDF-" header AND a
 * "%%EOF" trailer within the last 2 KB; PNG/JPEG by their standard signatures.
 * @param {Buffer} buffer - the file contents
 * @returns {string} MIME type of the detected format
 * @throws {UserError} when the contents match none of the supported formats
 */
export function sniff(buffer) {
  if(buffer.subarray(0,5).toString()==='%PDF-' && buffer.subarray(Math.max(0,buffer.length-2048)).toString().includes('%%EOF')) return 'application/pdf';
  if(buffer.length>8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if(buffer.length>4&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255) return 'image/jpeg';
  throw new UserError('Use a valid PDF, JPEG or PNG file.');
}

/**
 * Stream up to `max` bytes from a fetch response. Rejects early when the
 * Content-Length header already exceeds the limit (before reading anything),
 * otherwise accumulates chunks and aborts the body the moment it grows past
 * the limit — so a lying header can never blow up memory.
 * @param {Response} response - the fetch response to read
 * @param {number} max - maximum accepted body size in bytes
 * @returns {Promise<Buffer>} the accumulated body
 * @throws {UserError} when the body is larger than `max`
 */
async function limitedBody(response,max) {
  if(Number(response.headers.get('content-length')||0)>max) throw new UserError('File is too large.');
  const chunks=[];let size=0;
  for await(const chunk of response.body) { size+=chunk.length;if(size>max) { await response.body.cancel?.().catch(()=>{});throw new UserError('File is too large.'); } chunks.push(chunk); }
  return Buffer.concat(chunks);
}

/**
 * Download a WhatsApp media attachment by its media ID. Two-stage fetch: first
 * the metadata endpoint (checks MIME type and declared size), then the actual
 * CDN URL — which must be a facebook.com/fbcdn.net HTTPS URL with no port and
 * no credentials, so a compromised metadata response can't redirect to an
 * attacker host. The downloaded bytes are re-sniffed so the claimed MIME type
 * can't be spoofed either.
 * @param {string} mediaId - WhatsApp media ID (digits only)
 * @param {string[]} [allowed=['image/jpeg','image/png']] - accepted MIME types
 * @param {number} [max=MEDIA_LIMIT] - maximum accepted size in bytes
 * @returns {Promise<{buffer: Buffer, mime: string}>} the file contents and sniffed MIME type
 * @throws {UserError} on expired/invalid media, unsupported types, or oversized files
 */
export async function downloadMedia(mediaId,allowed=['image/jpeg','image/png'],max=MEDIA_LIMIT) {
  if(!/^\d{1,40}$/.test(String(mediaId))) throw new UserError('Invalid media.');
  const opts={headers:{Authorization:'Bearer '+config.waToken},signal:AbortSignal.timeout(15000),redirect:'error'};
  const metaRes=await fetch(API+'/'+mediaId,opts);if(!metaRes.ok)throw new UserError('Media expired. Please send it again.');
  const meta=await metaRes.json(); if(!allowed.includes(meta.mime_type)||Number(meta.file_size)>max)throw new UserError('Unsupported media or file too large (maximum 1 MB).');
  const url=new URL(meta.url);
  if(url.protocol!=='https:'||url.port||url.username||url.password||!/(^|\.)(facebook\.com|fbcdn\.net)$/.test(url.hostname))throw new UserError('Invalid media download address.');
  const res=await fetch(url,opts);if(!res.ok)throw new UserError('Could not download the file.');
  const buffer=await limitedBody(res,max);const mime=sniff(buffer);if(!allowed.includes(mime))throw new UserError('File contents do not match the supported format.');
  return {buffer,mime};
}

/**
 * Upload a file buffer to WhatsApp (e.g. a generated receipt or mark sheet)
 * and return the media ID that senders then attach to a message.
 * @param {string} phone - the school's WhatsApp phone_number_id
 * @param {Buffer} buffer - the file contents
 * @param {string} mime - MIME type of the file
 * @param {string} name - filename shown to the recipient
 * @returns {Promise<string>} the WhatsApp media ID
 * @throws {UserError} when the upload fails
 */
export async function uploadMedia(phone,buffer,mime,name) {
  if(!/^\d+$/.test(String(phone)))throw new UserError('School sender is not configured.');
  const form=new FormData();form.set('messaging_product','whatsapp');form.set('type',mime);form.set('file',new Blob([buffer],{type:mime}),name);
  const res=await fetch(API+'/'+phone+'/media',{method:'POST',headers:{Authorization:'Bearer '+config.waToken},body:form,signal:AbortSignal.timeout(20000)});
  if(!res.ok)throw new UserError('Document upload failed. Try again later.'); const result=await res.json();return result.id;
}
