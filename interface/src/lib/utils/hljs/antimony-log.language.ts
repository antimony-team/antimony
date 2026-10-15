export default () => ({
  case_insensitive: false,
  contains: [
    {
      className: 'linenumber',
      begin: /^\d+(?=ඞ)/,
    },
    {
      className: 'linenumber-separator',
      begin: /ඞ/,
    },
    {
      className: 'timestamp',
      begin: /\d{2}:\d{2}:\d{2}\s/,
    },
    {
      className: 'keyvalue',
      begin: /\s\w+=/,
    },
    // Log sources
    {
      className: 'log-source server',
      begin: /\bSERV\b/,
    },
    {
      className: 'log-source kubectl',
      begin: /\bKUBE\b/,
    },
    {
      className: 'log-source clab',
      begin: /\bCLAB\b/,
    },
    // Log levels
    {
      className: 'log-level success',
      begin: /\bSUCCESS\b/,
    },
    {
      className: 'log-level info',
      begin: /\bINFO\b/,
    },
    {
      className: 'log-level warn',
      begin: /\bWARNING\b/,
    },
    {
      className: 'log-level error',
      begin: /\bERROR\b/,
    },
  ],
});
