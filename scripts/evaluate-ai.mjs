import { config as loadEnv } from 'dotenv';
import { parseAiConfig } from '../apps/api/dist/modules/ai/config.js';
import { createChatProvider } from '../apps/api/dist/modules/ai/provider.js';
import { createAiService } from '../apps/api/dist/modules/ai/service.js';
import { createMemoryAiRunStore } from '../apps/api/dist/modules/ai/store.js';
import { publishedBookFixture } from '@bookleaf/contracts/fixtures';

loadEnv({ path: new URL('../.env', import.meta.url), quiet: true });
// Two sequential calls maximum, synthetic query plus the supplied sample book only.
// No database writes, retries, paid fallback, key printing, or author contact information.
try {
  const config = parseAiConfig(process.env);
  if (config.AI_PROVIDER === 'disabled') {
    console.log('Live AI unverified: AI_PROVIDER is disabled. No provider requests made.');
  } else {
    const service = createAiService({
      config,
      provider: createChatProvider(config),
      store: createMemoryAiRunStore(),
    });
    const context = {
      ticketId: 'live-evaluation-only',
      authorId: publishedBookFixture.authorId,
      contextRevision: 0,
      subject: 'Please explain pending royalties',
      description:
        'What does the pending royalty snapshot mean? When can the team confirm my payout?',
      category: null,
      book: publishedBookFixture,
      account: null,
      publicReplies: [],
    };
    const classification = await service.classifyTicket(context);
    console.log(
      JSON.stringify({
        task: 'CLASSIFICATION',
        state: classification.state,
        result: classification.result,
        failure: classification.failure,
        usage: classification.usage,
      }),
    );
    if (
      classification.state === 'SUCCEEDED' &&
      classification.result &&
      'category' in classification.result
    ) {
      const draft = await service.draftResponse({
        ...context,
        category: classification.result.category,
      });
      console.log(
        JSON.stringify({
          task: 'DRAFT',
          state: draft.state,
          result: draft.result,
          failure: draft.failure,
          usage: draft.usage,
        }),
      );
      if (draft.state !== 'SUCCEEDED') process.exitCode = 1;
    } else process.exitCode = 1;
    console.log(
      'Review output manually: policy accuracy, INR 3570 snapshot, no confirmed payout date, no completed external action. This is one case, not a quality benchmark.',
    );
  }
} catch {
  console.error(
    'AI evaluation could not run. Check AI configuration and build prerequisites; sensitive details are suppressed.',
  );
  process.exitCode = 1;
}
