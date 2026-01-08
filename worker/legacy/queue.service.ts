/**
 * Queue Service - Background Job Processing
 * 
 * Uses Cloudflare Queues for async tasks:
 * - Lead summarization
 * - Follow-up scheduling
 * - Analytics aggregation
 * 
 * Queue: netcar-background
 * DLQ: netcar-dlq
 */

import type { Env } from '@types';

// Job types
export type JobType = 
  | 'SUMMARIZE_LEAD'
  | 'SCHEDULE_FOLLOWUP'
  | 'AGGREGATE_ANALYTICS'
  | 'SEND_NOTIFICATION'
  | 'SYNC_INVENTORY';

interface BaseJob {
  type: JobType;
  id: string;
  createdAt: string;
  retryCount?: number;
}

interface SummarizeLeadJob extends BaseJob {
  type: 'SUMMARIZE_LEAD';
  leadId: string;
  phone: string;
}

interface ScheduleFollowupJob extends BaseJob {
  type: 'SCHEDULE_FOLLOWUP';
  leadId: string;
  phone: string;
  delay: number; // seconds
  message: string;
}

interface AggregateAnalyticsJob extends BaseJob {
  type: 'AGGREGATE_ANALYTICS';
  period: 'hourly' | 'daily';
  timestamp: string;
}

interface SendNotificationJob extends BaseJob {
  type: 'SEND_NOTIFICATION';
  channel: 'whatsapp' | 'webhook';
  recipient: string;
  message: string;
}

interface SyncInventoryJob extends BaseJob {
  type: 'SYNC_INVENTORY';
  source: string;
}

export type Job = 
  | SummarizeLeadJob 
  | ScheduleFollowupJob 
  | AggregateAnalyticsJob
  | SendNotificationJob
  | SyncInventoryJob;

// Input types for creating jobs (without id and createdAt)
type SummarizeLeadInput = Omit<SummarizeLeadJob, 'id' | 'createdAt'>;
type ScheduleFollowupInput = Omit<ScheduleFollowupJob, 'id' | 'createdAt'>;
type AggregateAnalyticsInput = Omit<AggregateAnalyticsJob, 'id' | 'createdAt'>;
type SendNotificationInput = Omit<SendNotificationJob, 'id' | 'createdAt'>;
type SyncInventoryInput = Omit<SyncInventoryJob, 'id' | 'createdAt'>;

export type JobInput = 
  | SummarizeLeadInput
  | ScheduleFollowupInput
  | AggregateAnalyticsInput
  | SendNotificationInput
  | SyncInventoryInput;

/**
 * Enqueue a job for background processing
 */
export async function enqueueJob(job: JobInput, env: Env): Promise<boolean> {
  if (!env.BACKGROUND_QUEUE) {
    console.warn('[Queue] Queue not configured, skipping job:', job.type);
    return false;
  }

  try {
    const fullJob = {
      ...job,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };

    await env.BACKGROUND_QUEUE.send(fullJob);
    console.log(`[Queue] Enqueued job: ${job.type} (${fullJob.id})`);
    return true;
  } catch (error) {
    console.error('[Queue] Failed to enqueue job:', error);
    return false;
  }
}

/**
 * Process a batch of jobs (called by queue consumer)
 */
export async function processJobs(
  batch: MessageBatch<Job>,
  env: Env
): Promise<void> {
  console.log(`[Queue] Processing batch of ${batch.messages.length} jobs`);

  for (const message of batch.messages) {
    const job = message.body;
    
    try {
      console.log(`[Queue] Processing job: ${job.type} (${job.id})`);
      
      switch (job.type) {
        case 'SUMMARIZE_LEAD':
          await processSummarizeLead(job, env);
          break;
          
        case 'SCHEDULE_FOLLOWUP':
          await processScheduleFollowup(job, env);
          break;
          
        case 'AGGREGATE_ANALYTICS':
          await processAggregateAnalytics(job, env);
          break;
          
        case 'SEND_NOTIFICATION':
          await processSendNotification(job, env);
          break;
          
        case 'SYNC_INVENTORY':
          await processSyncInventory(job, env);
          break;
          
        default:
          console.warn(`[Queue] Unknown job type: ${(job as Job).type}`);
      }
      
      message.ack();
      console.log(`[Queue] Job completed: ${job.type} (${job.id})`);
      
    } catch (error) {
      console.error(`[Queue] Job failed: ${job.type} (${job.id})`, error);
      message.retry();
    }
  }
}

// =============================================================================
// JOB PROCESSORS
// =============================================================================

async function processSummarizeLead(job: SummarizeLeadJob, env: Env): Promise<void> {
  // TODO: Implement lead summarization using LLM
  console.log(`[Queue] Would summarize lead: ${job.leadId}`);
}

async function processScheduleFollowup(job: ScheduleFollowupJob, env: Env): Promise<void> {
  // TODO: Implement follow-up scheduling
  console.log(`[Queue] Would schedule followup for: ${job.phone} after ${job.delay}s`);
}

async function processAggregateAnalytics(job: AggregateAnalyticsJob, env: Env): Promise<void> {
  // TODO: Aggregate metrics from D1 to Analytics Engine
  console.log(`[Queue] Would aggregate ${job.period} analytics for: ${job.timestamp}`);
}

async function processSendNotification(job: SendNotificationJob, env: Env): Promise<void> {
  // TODO: Send notification via WhatsApp or webhook
  console.log(`[Queue] Would send ${job.channel} notification to: ${job.recipient}`);
}

async function processSyncInventory(job: SyncInventoryJob, env: Env): Promise<void> {
  // TODO: Sync inventory from external source
  console.log(`[Queue] Would sync inventory from: ${job.source}`);
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Schedule a lead summarization
 * @param phone - Phone number (used as leadId for now)
 */
export async function scheduleSummarizeLead(
  phone: string, 
  env: Env
): Promise<boolean> {
  return enqueueJob({
    type: 'SUMMARIZE_LEAD',
    leadId: phone, // Use phone as leadId for simplicity
    phone,
  }, env);
}

/**
 * Schedule a follow-up message
 */
export async function scheduleFollowup(
  leadId: string,
  phone: string,
  message: string,
  delaySeconds: number,
  env: Env
): Promise<boolean> {
  return enqueueJob({
    type: 'SCHEDULE_FOLLOWUP',
    leadId,
    phone,
    message,
    delay: delaySeconds,
  }, env);
}

/**
 * Schedule analytics aggregation
 */
export async function scheduleAnalyticsAggregation(
  period: 'hourly' | 'daily',
  env: Env
): Promise<boolean> {
  return enqueueJob({
    type: 'AGGREGATE_ANALYTICS',
    period,
    timestamp: new Date().toISOString(),
  }, env);
}
