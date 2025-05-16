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
      className: 'antimony',
      begin: /\bANTIMONY\b/,
    },
    {
      className: 'error',
      begin: /\bERROR|Error\b/,
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
