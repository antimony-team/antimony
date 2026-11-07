import hljs from 'highlight.js/lib/core';

import antimonyLogLanguage from './antimony-log.language';
import genericLogLanguage from './generic-log.language';

hljs.registerLanguage('generic-log', genericLogLanguage);
hljs.registerLanguage('antimony-log', antimonyLogLanguage);

export default hljs;
