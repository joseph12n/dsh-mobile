/**
 * Message catalogue.
 *
 * Four languages: English (default), Spanish, Brazilian Portuguese and Simplified
 * Chinese. Chinese is not decoration: DSH serves Chinese models, so someone working
 * with them is likely to read it.
 *
 * Keys are flat and typed. A `Record<Key, string>` per locale means the compiler
 * refuses a catalogue that is missing a key, and `catalogues.test.ts` checks the same
 * thing at runtime for every locale.
 */

export const LOCALES = ['en', 'es', 'pt-BR', 'zh-Hans'] as const;

export type Locale = (typeof LOCALES)[number];

/** Language names, each written in its own language: that is what a picker wants. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
  'zh-Hans': '简体中文',
};

const en = {
  'app.subtitle': 'Remote control for DeepSeek Harness',

  'state.checking': 'Checking…',
  'state.connecting': 'Connecting',
  'state.reconnecting': 'Reconnecting…',
  'state.pairing': 'Not paired',
  'state.error': 'Could not connect',

  'pairing.explain':
    'Open the QR on your desktop and scan it with your phone camera. If you cannot, type the code and the host address.',
  'pairing.code': 'Code',
  'pairing.host': 'Host',
  'pairing.submit': 'Pair',

  'reconnect.kept': 'The pairing is still saved.',
  'reconnect.attempt': 'Attempt {attempt}, retrying in {seconds} s.',
  'reconnect.now': 'Retry now',

  'error.authLost': 'The host no longer recognises this device. Pair it again.',
  'settings.language': 'Language',

  'error.retry': 'Retry',
  'error.forget': 'Forget this device',

  'sessions.title': 'Sessions',
  'sessions.refresh': 'Refresh',
  'sessions.empty': 'No live sessions on the host.',

  'group.waiting': 'Waiting for you',
  'group.working': 'Working',
  'group.idle': 'Idle',
  'group.stale': 'Older',
  'group.show': 'Show',
  'group.hide': 'Hide',

  'session.working': 'working',
  'session.waiting': 'waiting',
  'session.idle': 'idle',
  'session.done': 'done',
  'session.error': 'error',
  'session.back': '← Back',
  'session.stop': 'Stop',
  'session.loadMore': 'Load earlier',
  'session.loading': 'Loading…',
  'session.empty': 'Nothing to show yet.',
  'session.send': 'Send',
  'session.placeholder': 'Write to the agent…',
  'session.you': 'you',
  'session.agent': 'agent',
  'session.turn': 'Turn {number}',
  'session.tools': '{count} tool',
  'session.tools_plural': '{count} tools',
  'session.hideTools': 'hide',
  'session.questionCount': '{count} question',
  'session.questionCount_plural': '{count} questions',

  'questions.title': 'Waiting for you',
  'questions.other': 'Or write another answer…',
  'questions.submit': 'Send answer',

  'time.now': 'just now',
  'time.minutes': '{count} min ago',
  'time.hours': '{count} h ago',
  'time.days': '{count} d ago',
};

/** Every key the app can ask for. */
export type MessageKey = keyof typeof en;

export type Catalogue = Record<MessageKey, string>;

const es: Catalogue = {
  'app.subtitle': 'Control remoto de DeepSeek Harness',

  'state.checking': 'Comprobando…',
  'state.connecting': 'Conectando',
  'state.reconnecting': 'Reconectando…',
  'state.pairing': 'Sin emparejar',
  'state.error': 'No pude conectar',

  'pairing.explain':
    'Abre el QR en el escritorio y escanéalo con la cámara del teléfono. Si no puedes, escribe el código y la dirección del host.',
  'pairing.code': 'Código',
  'pairing.host': 'Host',
  'pairing.submit': 'Emparejar',

  'reconnect.kept': 'El emparejamiento sigue guardado.',
  'reconnect.attempt': 'Intento {attempt}, reintento en {seconds} s.',
  'reconnect.now': 'Reintentar ahora',

  'error.authLost': 'El host ya no reconoce este dispositivo. Vuelve a emparejarlo.',
  'settings.language': 'Idioma',

  'error.retry': 'Reintentar',
  'error.forget': 'Olvidar este dispositivo',

  'sessions.title': 'Sesiones',
  'sessions.refresh': 'Actualizar',
  'sessions.empty': 'No hay sesiones vivas en el host.',

  'group.waiting': 'Esperando tu respuesta',
  'group.working': 'Trabajando',
  'group.idle': 'En reposo',
  'group.stale': 'Más antiguas',
  'group.show': 'Mostrar',
  'group.hide': 'Ocultar',

  'session.working': 'trabajando',
  'session.waiting': 'espera respuesta',
  'session.idle': 'en reposo',
  'session.done': 'terminada',
  'session.error': 'error',
  'session.back': '← Volver',
  'session.stop': 'Detener',
  'session.loadMore': 'Cargar anteriores',
  'session.loading': 'Cargando…',
  'session.empty': 'Todavía no hay nada que mostrar.',
  'session.send': 'Enviar',
  'session.placeholder': 'Escribe al agente…',
  'session.you': 'tú',
  'session.agent': 'agente',
  'session.turn': 'Turno {number}',
  'session.tools': '{count} herramienta',
  'session.tools_plural': '{count} herramientas',
  'session.hideTools': 'ocultar',
  'session.questionCount': '{count} pregunta',
  'session.questionCount_plural': '{count} preguntas',

  'questions.title': 'Te está esperando',
  'questions.other': 'O escribe otra respuesta…',
  'questions.submit': 'Enviar respuesta',

  'time.now': 'ahora',
  'time.minutes': 'hace {count} min',
  'time.hours': 'hace {count} h',
  'time.days': 'hace {count} d',
};

const ptBR: Catalogue = {
  'app.subtitle': 'Controle remoto do DeepSeek Harness',

  'state.checking': 'Verificando…',
  'state.connecting': 'Conectando',
  'state.reconnecting': 'Reconectando…',
  'state.pairing': 'Não emparelhado',
  'state.error': 'Não consegui conectar',

  'pairing.explain':
    'Abra o QR no computador e escaneie com a câmera do celular. Se não conseguir, digite o código e o endereço do host.',
  'pairing.code': 'Código',
  'pairing.host': 'Host',
  'pairing.submit': 'Emparelhar',

  'reconnect.kept': 'O emparelhamento continua salvo.',
  'reconnect.attempt': 'Tentativa {attempt}, novo intento em {seconds} s.',
  'reconnect.now': 'Tentar agora',

  'error.authLost': 'O host não reconhece mais este dispositivo. Emparelhe de novo.',
  'settings.language': 'Idioma',

  'error.retry': 'Tentar de novo',
  'error.forget': 'Esquecer este dispositivo',

  'sessions.title': 'Sessões',
  'sessions.refresh': 'Atualizar',
  'sessions.empty': 'Nenhuma sessão ativa no host.',

  'group.waiting': 'Esperando você',
  'group.working': 'Trabalhando',
  'group.idle': 'Paradas',
  'group.stale': 'Mais antigas',
  'group.show': 'Mostrar',
  'group.hide': 'Ocultar',

  'session.working': 'trabalhando',
  'session.waiting': 'espera resposta',
  'session.idle': 'parada',
  'session.done': 'concluída',
  'session.error': 'erro',
  'session.back': '← Voltar',
  'session.stop': 'Parar',
  'session.loadMore': 'Carregar anteriores',
  'session.loading': 'Carregando…',
  'session.empty': 'Ainda não há nada para mostrar.',
  'session.send': 'Enviar',
  'session.placeholder': 'Escreva para o agente…',
  'session.you': 'você',
  'session.agent': 'agente',
  'session.turn': 'Turno {number}',
  'session.tools': '{count} ferramenta',
  'session.tools_plural': '{count} ferramentas',
  'session.hideTools': 'ocultar',
  'session.questionCount': '{count} pergunta',
  'session.questionCount_plural': '{count} perguntas',

  'questions.title': 'Esperando você',
  'questions.other': 'Ou escreva outra resposta…',
  'questions.submit': 'Enviar resposta',

  'time.now': 'agora',
  'time.minutes': 'há {count} min',
  'time.hours': 'há {count} h',
  'time.days': 'há {count} d',
};

const zhHans: Catalogue = {
  'app.subtitle': 'DeepSeek Harness 远程控制',

  'state.checking': '检查中…',
  'state.connecting': '连接中',
  'state.reconnecting': '重新连接中…',
  'state.pairing': '尚未配对',
  'state.error': '无法连接',

  'pairing.explain': '在电脑上打开二维码，用手机相机扫描。如果扫不了，输入配对码和主机地址。',
  'pairing.code': '配对码',
  'pairing.host': '主机',
  'pairing.submit': '配对',

  'reconnect.kept': '配对信息仍然保留。',
  'reconnect.attempt': '第 {attempt} 次尝试，{seconds} 秒后重试。',
  'reconnect.now': '立即重试',

  'error.authLost': '主机已不识别此设备，请重新配对。',
  'settings.language': '语言',

  'error.retry': '重试',
  'error.forget': '忘记此设备',

  'sessions.title': '会话',
  'sessions.refresh': '刷新',
  'sessions.empty': '主机上没有活跃会话。',

  'group.waiting': '等待你回复',
  'group.working': '进行中',
  'group.idle': '空闲',
  'group.stale': '更早的',
  'group.show': '显示',
  'group.hide': '隐藏',

  'session.working': '进行中',
  'session.waiting': '等待回复',
  'session.idle': '空闲',
  'session.done': '已完成',
  'session.error': '错误',
  'session.back': '← 返回',
  'session.stop': '停止',
  'session.loadMore': '加载更早的',
  'session.loading': '加载中…',
  'session.empty': '还没有可显示的内容。',
  'session.send': '发送',
  'session.placeholder': '给智能体写消息…',
  'session.you': '你',
  'session.agent': '智能体',
  'session.turn': '第 {number} 轮',
  'session.tools': '{count} 个工具',
  'session.tools_plural': '{count} 个工具',
  'session.hideTools': '隐藏',
  'session.questionCount': '{count} 个问题',
  'session.questionCount_plural': '{count} 个问题',

  'questions.title': '等待你回复',
  'questions.other': '或者写另一个回答…',
  'questions.submit': '发送回答',

  'time.now': '刚刚',
  'time.minutes': '{count} 分钟前',
  'time.hours': '{count} 小时前',
  'time.days': '{count} 天前',
};

export const CATALOGUES: Record<Locale, Catalogue> = {
  en,
  es,
  'pt-BR': ptBR,
  'zh-Hans': zhHans,
};
