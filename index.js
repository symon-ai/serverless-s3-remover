'use strict';

const chalk = require('chalk');
const messagePrefix = 'S3 Remover: ';

class Remover {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.provider = this.serverless.getProvider('aws');

    this.commands = {
      s3remove: {
        usage: 'Remove all files in S3 buckets',
        lifecycleEvents: [
          'remove'
        ],
        options: {
          verbose: {
            usage: 'Increase verbosity',
            shortcut: 'v'
          }
        }
      }
    };

    this.hooks = {
      'before:remove:remove': () => Promise.resolve().then(this.remove.bind(this)),
      's3remove:remove': () => Promise.resolve().then(this.remove.bind(this))
    };
  }

  log(message) {
    if (this.options.verbose) {
      this.serverless.cli.log(message);
    }
  }

  remove() {
    const self = this;

    const getAllKeys = (bucket) => {
      const get = (src = {}) => {
        const data = src.data;
        const keys = src.keys || [];
        const param = {
          Bucket: bucket
        };
        if (data) {
          param.ContinuationToken = data.NextContinuationToken;
        }
        return self.provider.request('S3', 'listObjectsV2', param).then((result) => {
          return new Promise((resolve) => {
            resolve({
              data: result, keys: keys.concat(result.Contents.map((item) => {
                return item.Key;
              }))
            });
          });
        });
      };
      const list = (src = {}) => {
        return get(src).then((result) => {
          if (result.data.IsTruncated) {
            return list(result);
          } else {
            const keys = result.keys;
            const batched = [];
            for (let i = 0; i < keys.length; i += 1000) {
              const objects = keys.slice(i, i + 1000).map((item) => {
                return {Key: item};
              });
              batched.push({
                Bucket: bucket,
                Delete: {
                  Objects: objects
                }
              });
            }
            return new Promise((resolve) => {
              resolve(batched);
            });
          }
        });
      };
      return list();
    };
    const executeRemove = (params) => {
      return Promise.all(params.map(param => {
        return self.provider.request('S3', 'deleteObjects', param);
      }));
    };

    const populateConfig = () => {
      return this.serverless.variables.populateObject(this.serverless.service.custom.remover)
        .then(fileConfig => {
          const defaultConfig = {
            buckets: []
          };
          return Object.assign({}, defaultConfig, fileConfig);
        });
    };

    return new Promise((resolve) => {
      return populateConfig().then(config => {
        let promises = [];
        for (const b of config.buckets) {
          promises.push(getAllKeys(b).then(executeRemove).then(() => {
            const message = `Success: ${b} is empty.`;
            self.log(message);
            self.serverless.cli.consoleLog(`${messagePrefix}${chalk.yellow(message)}`);
          }).catch((err) => {
            const message = `Failed: ${b} may not be empty.`;
            self.log(message);
            self.log(err);
            self.serverless.cli.consoleLog(`${messagePrefix}${chalk.yellow(message)}`);
          }));
        }
        return Promise.all(promises).then(resolve);
      });
    });
  }
}

module.exports = Remover;
