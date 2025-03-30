export default () => ({
  case_insensitive: true,
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
      begin: /\d{2}:\d{2}:\d{2}/,
    },
    {
      className: 'error',
      begin: /\bERROR\b/,
    },
    {
      className: 'warning',
      begin: /\bWARN\b/,
    },
    {
      className: 'info',
      begin: /\bINFO\b/,
    },
    {
      className: 'keyvalue',
      begin: /\s\w+=/,
    },
  ],
});
