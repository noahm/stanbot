function preface(messagePrefix?: string) {
  return `[${new Date().toISOString()}]${messagePrefix ? ' ' + messagePrefix : ''}`;
}

export const logger = {
  log(...args: any[]) {
    console.log(preface(), ...args);
  },
  error(...args: any[]) {
    console.error(preface(), ...args);
  },
};
