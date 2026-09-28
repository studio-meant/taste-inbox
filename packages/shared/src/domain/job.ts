import { z } from "zod";
import { IsoDateTimeSchema } from "../host/host-profile";

/** Source of truth: docs/FRONTEND_COMPONENT_ARCHITECTURE.md §11 → "Job" and §17. */

export const JobStateSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "partially_succeeded",
  "failed",
  "cancelled",
  "blocked",
]);

export const JobStepStateSchema = z.enum(["waiting", "running", "done", "failed", "skipped"]);

/**
 * Mirrors `db/models.py::JOB_TYPES`. The inherited `build`/`run`/`price`/`cleanup` went on
 * 2026-09-28 with the features that produced them.
 */
export const JobTypeSchema = z.enum([
  "collection",
  "enrichment",
  /**
   * The pass that turns a user's question into a verification goal, acceptance criteria
   * and a trial plan (2026-09-28, `research/question.py`).
   *
   * Added here the same day it was added to the service, and for the reason the note
   * below already records: a type this enum lacks rejects the whole job list and takes
   * every workspace page down with it. It happened again with this one.
   */
  "plan",
  /**
   * NVIDIA AI-Q research on one item, and one approved sandbox trial (2026-09-28).
   *
   * The service writes both types into the same `jobs` table, and the workspace layout
   * lists every job on each render — so a type this enum lacks rejects the whole list and
   * takes down every workspace page with it. That is how these two were found missing.
   */
  "research",
  "trial",
]);

export const JobStepSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  state: JobStepStateSchema,
  startedAt: IsoDateTimeSchema.nullable().optional(),
  finishedAt: IsoDateTimeSchema.nullable().optional(),
  message: z.string().nullable().optional(),
});

export const JobModelSchema = z.object({
  id: z.string().min(1),
  type: JobTypeSchema,
  state: JobStateSchema,
  targetId: z.string().nullable().optional(),
  title: z.string().min(1),
  currentStep: z.string().nullable().optional(),
  steps: z.array(JobStepSchema),
  startedAt: IsoDateTimeSchema.nullable().optional(),
  finishedAt: IsoDateTimeSchema.nullable().optional(),
  cancellable: z.boolean(),
});

export const JobEventTypeSchema = z.enum([
  "job_created",
  "job_started",
  "step_started",
  "step_completed",
  "step_failed",
  "job_completed",
  "job_failed",
  "job_cancelled",
]);

export const JobEventSchema = z.object({
  eventId: z.string().min(1),
  jobId: z.string().min(1),
  type: JobEventTypeSchema,
  payload: z.unknown(),
  occurredAt: IsoDateTimeSchema,
});

export type JobState = z.infer<typeof JobStateSchema>;
export type JobStepState = z.infer<typeof JobStepStateSchema>;
export type JobType = z.infer<typeof JobTypeSchema>;
export type JobStep = z.infer<typeof JobStepSchema>;
export type JobModel = z.infer<typeof JobModelSchema>;
export type JobEventType = z.infer<typeof JobEventTypeSchema>;
export type JobEvent = z.infer<typeof JobEventSchema>;
