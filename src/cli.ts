#!/usr/bin/env node
/**
 * CLI entry point for resolve-mcp
 * Can be run via npx resolve-mcp
 */

import { Command } from 'commander';
import { ResolveMCPServer } from './server/mcp-server.js';
import { approvalManager, cliApprovalHandler } from './utils/approval.js';
import { bridgeClient } from './bridge/bridge-client.js';
import chalk from 'chalk';

const program = new Command();

program
  .name('resolve-mcp')
  .description('MCP server connecting AI assistants to DaVinci Resolve Studio')
  .version('0.1.0')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('--auto-approve', 'Auto-approve all actions (for testing only)')
  .option('--test-connection', 'Test connection to DaVinci Resolve and exit');

program
  .command('serve')
  .description('Start the MCP server (default command)')
  .action(async (options: { verbose?: boolean; autoApprove?: boolean }) => {
    if (options.verbose) {
      console.error(chalk.gray('Verbose logging enabled'));
    }

    if (options.autoApprove) {
      console.error(chalk.yellow('⚠️  Auto-approve mode enabled - all actions will be approved automatically'));
      approvalManager.setAutoApprove(true);
    } else {
      // Set up CLI approval handler for interactive use
      approvalManager.setHandler(cliApprovalHandler);
    }

    const server = new ResolveMCPServer();
    await server.run();
  });

program
  .command('test')
  .description('Test connection to DaVinci Resolve')
  .action(async () => {
    console.error(chalk.blue('Testing connection to DaVinci Resolve...'));

    const result = await bridgeClient.getVersion();

    if (result.success) {
      console.error(chalk.green('✓ Connected to DaVinci Resolve'));
      console.error(chalk.gray(JSON.stringify(result.data, null, 2)));
    } else {
      console.error(chalk.red('✗ Failed to connect:'), result.error);
      process.exit(1);
    }

    // Also test project connection
    const projectResult = await bridgeClient.getProject();
    if (projectResult.success) {
      console.error(chalk.green('✓ Project connected:'), (projectResult.data as any).name);
    } else {
      console.error(chalk.yellow('⚠ No project open:'), projectResult.error);
    }

    await bridgeClient.disconnect();
  });

program
  .command('doctor')
  .description('Check system requirements and configuration')
  .action(() => {
    console.error(chalk.blue('Resolve MCP System Check\n'));

    // Check Node version
    const nodeVersion = String(process.version);
    const versionParts = nodeVersion.slice(1).split('.');
    const majorVersion = parseInt(versionParts[0] ?? '0', 10);
    if (majorVersion >= 20) {
      console.error(chalk.green(`✓ Node.js ${nodeVersion} (>=20 required)`));
    } else {
      console.error(chalk.red(`✗ Node.js ${nodeVersion} (>=20 required)`));
    }

    // Check platform
    const platform = process.platform;
    console.error(chalk.gray(`Platform: ${platform}`));

    // Check Python
    import('child_process').then(({ spawn }) => {
      const pythonCmd = platform === 'win32' ? 'python' : 'python3';
      const python = spawn(pythonCmd, ['--version']);
      python.on('close', (code) => {
        if (code === 0) {
          console.error(chalk.green('✓ Python available'));
        } else {
          console.error(chalk.red('✗ Python not found'));
        }
      });
    });

    // Check Resolve scripting module
    console.error(chalk.gray('\nDaVinci Resolve scripting module paths:'));
    if (platform === 'darwin') {
      console.error(chalk.gray('  /Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules'));
    } else if (platform === 'win32') {
      console.error(chalk.gray('  C:/ProgramData/Blackmagic Design/DaVinci Resolve/Support/Developer/Scripting/Modules'));
    } else {
      console.error(chalk.gray('  /opt/resolve/Developer/Scripting/Modules'));
    }

    console.error(chalk.gray('\nFor more info, see: https://github.com/anthropics/claude-code'));
  });

// Default command is serve
program.parse(process.argv);

// If no command provided, run serve
if (!process.argv.slice(2).length) {
  program.parse(['node', 'resolve-mcp', 'serve'], { from: 'user' });
}