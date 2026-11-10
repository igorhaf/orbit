import assert from "node:assert/strict";
import test from "node:test";
import { findVimeoCaptionsTrack, googleDrivePreviewUrl, youtubeCaptionEmbedUrl } from "./media-embeds";

const fileId = "1AbCdefGHij_Klmn-OPqrS";

test("Drive file links normalize to the trusted preview endpoint", () => {
  assert.equal(googleDrivePreviewUrl(`https://drive.google.com/file/d/${fileId}/view?usp=sharing`),
    `https://drive.google.com/file/d/${fileId}/preview`);
  assert.equal(googleDrivePreviewUrl(`http://drive.google.com/open?id=${fileId}`),
    `https://drive.google.com/file/d/${fileId}/preview`);
  assert.equal(googleDrivePreviewUrl(`https://drive.google.com/uc?export=download&id=${fileId}`),
    `https://drive.google.com/file/d/${fileId}/preview`);
});

test("Google Docs, Slides and Sheets use preview URLs without carrying query parameters", () => {
  for (const type of ["document", "presentation", "spreadsheets"]) {
    assert.equal(googleDrivePreviewUrl(`https://docs.google.com/${type}/d/${fileId}/edit?usp=sharing`),
      `https://docs.google.com/${type}/d/${fileId}/preview`);
  }
});

test("Drive preview rejects lookalike hosts, credentials, folders and malformed identifiers", () => {
  assert.equal(googleDrivePreviewUrl(`https://drive.google.com.evil.example/file/d/${fileId}/view`), null);
  assert.equal(googleDrivePreviewUrl(`https://docs.google.com.attacker.test/document/d/${fileId}/edit`), null);
  assert.equal(googleDrivePreviewUrl(`https://user@drive.google.com/file/d/${fileId}/view`), null);
  assert.equal(googleDrivePreviewUrl(`https://drive.google.com/drive/folders/${fileId}`), null);
  assert.equal(googleDrivePreviewUrl("https://drive.google.com/file/d/short/view"), null);
  assert.equal(googleDrivePreviewUrl(`javascript://drive.google.com/file/d/${fileId}/view`), null);
});

test("YouTube enables confirmed captions by default and prefers the reviewed language", () => {
  const url = new URL(youtubeCaptionEmbedUrl("https://www.youtube-nocookie.com/embed/AbCdEf12345", true, "pt-br")!);
  assert.equal(url.searchParams.get("enablejsapi"), "1");
  assert.equal(url.searchParams.get("cc_load_policy"), "1");
  assert.equal(url.searchParams.get("cc_lang_pref"), "pt-BR");
  const unconfirmed = new URL(youtubeCaptionEmbedUrl("https://www.youtube-nocookie.com/embed/AbCdEf12345", false, "pt-BR")!);
  assert.equal(unconfirmed.searchParams.has("cc_load_policy"), false);
  assert.equal(unconfirmed.searchParams.has("cc_lang_pref"), false);
});

test("YouTube captions helper only modifies canonical privacy-enhanced embeds", () => {
  assert.equal(youtubeCaptionEmbedUrl("https://youtube-nocookie.com/embed/AbCdEf12345", true), null);
  assert.equal(youtubeCaptionEmbedUrl("https://www.youtube-nocookie.com.attacker.test/embed/AbCdEf12345", true), null);
  assert.equal(youtubeCaptionEmbedUrl("https://user@www.youtube-nocookie.com/embed/AbCdEf12345", true), null);
  assert.equal(youtubeCaptionEmbedUrl("http://www.youtube-nocookie.com/embed/AbCdEf12345", true), null);
});

test("Vimeo picks captions in the reviewed locale and never mistakes subtitles for captions", () => {
  const tracks = [
    { language: "en", kind: "captions", label: "English CC" },
    { language: "pt-BR", kind: "subtitles", label: "Português (Brasil)" },
    { language: "pt-BR", kind: "captions", label: "Português (Brasil) CC" },
  ];
  assert.equal(findVimeoCaptionsTrack(tracks, "pt-br"), tracks[2]);
  assert.equal(findVimeoCaptionsTrack(tracks), tracks[0]);
  assert.equal(findVimeoCaptionsTrack(tracks, "fr"), null);
  assert.equal(findVimeoCaptionsTrack([{ language: "pt-BR", kind: "subtitles" }]), null);
});
