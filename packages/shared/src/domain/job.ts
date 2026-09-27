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

export const JobTypeSchema = z.enum([
  "collection",
  "enrichment",
  "build",
  "run",
  "price",
  "cleanup",
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
