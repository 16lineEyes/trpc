import { readdirSync, readFileSync, writeFile } from 'node:fs';
import path from 'node:path';
import analyze from 'rollup-plugin-analyzer';

const ABSOLUTE_BYTE_CHANGE_THRESHOLD = 100;
const PERCENT_CHANGE_THRESHOLD = 1;

export default function analyzeSizeChange(packageDir) {
  let analyzePluginIterations = 0;
  return analyze({
    summaryOnly: !process.env.CI,
    skipFormatted: !!process.env.CI,
    onAnalysis: (analysis) => {
      if (analyzePluginIterations > 0) return;
      analyzePluginIterations++;

      if (process.env.CI) {
        const { currentPath, prevPath } = resolveJsonPaths(packageDir);
        writeFile(currentPath, JSON.stringify(analysis, null, 2), (err) => {
          if (err) console.error('Error writing current analysis file:', err);
        });

        try {
          const prevStr = readFileSync(prevPath, 'utf8');
          const prevAnalysis = JSON.parse(prevStr);
          logSizeChanges(prevAnalysis, analysis);
        } catch (err) {
          console.log('No previous bundle analysis found:', err.message);
        }
      }
    },
  });
}

function logSizeChanges(prevAnalysis, analysis) {
  console.log('--- Size Change Report ---');
  console.log('(will be empty if no significant changes are found)');

  logDifference('Total Bundle', prevAnalysis.bundleSize, analysis.bundleSize);

  analysis.modules.forEach((module) => {
    const prevModule = prevAnalysis.modules.find((m) => m.id === module.id);
    if (prevModule) {
      logDifference(`Module '${module.id}'`, prevModule.size, module.size);
    } else {
      logNewModule(module.id, module.size);
    }
  });

  console.log('--- End Size Change Report ---');
}

function logNewModule(name, size) {
  if (size >= ABSOLUTE_BYTE_CHANGE_THRESHOLD) {
    logGithubMessage('notice', `${name} size: ${size} bytes`, {
      title: `New Module (${size} bytes in ${name})`,
    });
  }
}

function logDifference(name, before, after) {
  const { absolute, percent } = calculateDifference(before, after);
  if (absolute >= ABSOLUTE_BYTE_CHANGE_THRESHOLD || percent >= PERCENT_CHANGE_THRESHOLD) {
    logGithubMessage('error', `${name} size change: ${absolute} bytes (${percent.toFixed(2)}%)`, {
      title: `Important Size Change (${absolute} bytes in ${name})`,
    });
  }
}

function logGithubMessage(type, message, options = {}) {
  console.log(
    stripAnsiEscapes(
      `::${type} ${formatGithubOptions(options)}::${formatGithubMessage(message)}`
    )
  );
}

function calculateDifference(before, after) {
  const absolute = after - before;
  const percent = before ? ((after / before) * 100 - 100) : after ? Infinity : 0;
  return { absolute, percent };
}

function resolveJsonPaths(packageDir) {
  const runnerRoot = '../..';
  const analysisFilePath = 'dist/bundle-analysis.json';
  const previousAnalysisDir = 'downloads/previous-bundle-analysis';
  const currentPath = path.resolve(packageDir, analysisFilePath);
  const relativePath = path.relative(path.resolve(runnerRoot, 'packages'), packageDir);
  const prevPath = path.resolve(runnerRoot, previousAnalysisDir, relativePath, analysisFilePath);

  return { currentPath, prevPath };
}

const ansiRegex = /[\u001B\u009B][[()#;?]*(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~]*)*)?\u0007|(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]/g;

function stripAnsiEscapes(str) {
  return str.replace(ansiRegex, '');
}

function formatGithubOptions(options) {
  return Object.entries(options)
    .map(([key, option]) => `${key}=${option}`)
    .join(',');
}

function formatGithubMessage(message) {
  return message.replace(/\n/g, '%0A');
}
