// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

// Runs the full SafeJeonse story on a local Midnight network started in Docker.

import { createLogger } from '../logger-utils.js';
import { run } from '../index.js';
import { StandaloneConfig } from '../config.js';
import { demoStory } from '../demo-story.js';

const config = new StandaloneConfig();
const logger = await createLogger(config.logDir);
const testEnvironment = config.getEnvironment(logger);
await run(config, testEnvironment, logger, { kind: 'script', script: demoStory });
