export type BookStatus =
  | "uploaded"
  | "preparing"
  | "queued"
  | "generating"
  | "completed"
  | "failed"
  | "cancelled";

export type ChapterStatus = "pending" | "generating" | "completed" | "failed" | "cancelled";

export interface Book {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  source_filename: string;
  source_format: string;
  language_code: string | null;
  language_override: string | null;
  voice: string | null;
  status: BookStatus;
  total_chapters: number;
  completed_chapters: number;
  failed_chapters: number;
  total_duration_seconds: number;
  cover_path: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface Chapter {
  id: string;
  book_id: string;
  chapter_index: number;
  title: string | null;
  word_count: number;
  status: ChapterStatus;
  attempt_count: number;
  last_error: string | null;
  audio_path: string | null;
  duration_seconds: number | null;
  size_bytes: number | null;
}

export interface ListeningProgress {
  book_id: string;
  chapter_index: number;
  position_seconds: number;
  playback_rate: number;
  updated_at: string;
}

export const BOOK_COLUMNS =
  "id,user_id,title,author,source_filename,source_format,language_code,language_override,voice,status,total_chapters,completed_chapters,failed_chapters,total_duration_seconds,cover_path,error_code,error_message,created_at,updated_at";

export const CHAPTER_COLUMNS =
  "id,book_id,chapter_index,title,word_count,status,attempt_count,last_error,audio_path,duration_seconds,size_bytes";

export const ACTIVE_STATUSES: BookStatus[] = ["uploaded", "preparing", "queued", "generating"];
