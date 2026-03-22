/**
 * Base provider interface — all AI coding tool providers implement this.
 */
class BaseProvider {
  constructor(id, name, cliCommand) {
    this.id = id;
    this.name = name;
    this.cliCommand = cliCommand;
  }

  /** Check if the CLI tool is installed */
  async detect() {
    throw new Error('detect() not implemented');
  }

  /** Get plan/tier info: { tier, creditsRemaining, rateLimit } */
  async getPlanInfo() {
    throw new Error('getPlanInfo() not implemented');
  }

  /**
   * Execute a task
   * @param {object} task - The task record
   * @param {object} project - The project record
   * @param {object} options - { model, timeout }
   * @returns {{ success: boolean, output: string, error?: string }}
   */
  async execute(task, project, options = {}) {
    throw new Error('execute() not implemented');
  }
}

module.exports = BaseProvider;
