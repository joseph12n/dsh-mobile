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
  'action.newSession': 'New session',
  'action.archive': 'Archive',
  'action.stopFirst': 'Stop the turn before archiving',
  'action.archived': 'Archived',
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
  'settings.contrast': 'Contrast',
  'contrast.normal': 'Normal',
  'contrast.high': 'High',
  'contrast.low': 'Low',
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
  'group.noFolder': 'No folder',
  'group.emptyFolder': 'No sessions here yet.',
  'group.show': 'Show',
  'group.hide': 'Hide',

  'settings.title': 'Settings',
  'settings.folderOrder': 'Folder order',
  'settings.order.host': 'Host order',
  'settings.order.name': 'Name',
  'settings.order.recent': 'Recent activity',
  'settings.hideEmpty': 'Hide empty folders',
  'settings.folders': 'Folders shown',
  'settings.allHidden': 'All folders are hidden. Show one in Settings.',
  'settings.noneVisible':
    'Your folders are empty and hidden. Turn off “Hide empty folders” in Settings.',

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

  'model.label': 'Model',
  'model.effort': 'Reasoning',
  'model.effortDefault': 'Default',
  'model.none': 'No models available',
  'model.choose': 'Select model',

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
  'action.newSession': 'Nueva sesión',
  'action.archive': 'Archivar',
  'action.stopFirst': 'Detén el turno antes de archivar',
  'action.archived': 'Archivada',
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
  'settings.contrast': 'Contraste',
  'contrast.normal': 'Normal',
  'contrast.high': 'Alto',
  'contrast.low': 'Bajo',
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
  'group.noFolder': 'Sin carpeta',
  'group.emptyFolder': 'Todavía no hay sesiones aquí.',
  'group.show': 'Mostrar',
  'group.hide': 'Ocultar',

  'settings.title': 'Ajustes',
  'settings.folderOrder': 'Orden de carpetas',
  'settings.order.host': 'Orden del host',
  'settings.order.name': 'Nombre',
  'settings.order.recent': 'Actividad reciente',
  'settings.hideEmpty': 'Ocultar carpetas vacías',
  'settings.folders': 'Carpetas visibles',
  'settings.allHidden': 'Todas las carpetas están ocultas. Muestra alguna en Ajustes.',
  'settings.noneVisible':
    'Tus carpetas están vacías y ocultas. Desactiva «Ocultar carpetas vacías» en Ajustes.',

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

  'model.label': 'Modelo',
  'model.effort': 'Razonamiento',
  'model.effortDefault': 'Por defecto',
  'model.none': 'No hay modelos disponibles',
  'model.choose': 'Elegir modelo',

  'questions.title': 'Te está esperando',
  'questions.other': 'O escribe otra respuesta…',
  'questions.submit': 'Enviar respuesta',

  'time.now': 'ahora',
  'time.minutes': 'hace {count} min',
  'time.hours': 'hace {count} h',
  'time.days': 'hace {count} d',
};

const ptBR: Catalogue = {
  'action.newSession': 'Nova sessão',
  'action.archive': 'Arquivar',
  'action.stopFirst': 'Pare o turno antes de arquivar',
  'action.archived': 'Arquivada',
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
  'reconnect.attempt': 'Tentativa {attempt} · nova tentativa em {seconds} s.',
  'reconnect.now': 'Tentar agora',

  'error.authLost': 'O host não reconhece mais este dispositivo. Emparelhe de novo.',
  'settings.contrast': 'Contraste',
  'contrast.normal': 'Normal',
  'contrast.high': 'Alto',
  'contrast.low': 'Baixo',
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
  'group.noFolder': 'Sem pasta',
  'group.emptyFolder': 'Ainda não há sessões aqui.',
  'group.show': 'Mostrar',
  'group.hide': 'Ocultar',

  'settings.title': 'Ajustes',
  'settings.folderOrder': 'Ordem das pastas',
  'settings.order.host': 'Ordem do host',
  'settings.order.name': 'Nome',
  'settings.order.recent': 'Atividade recente',
  'settings.hideEmpty': 'Ocultar pastas vazias',
  'settings.folders': 'Pastas visíveis',
  'settings.allHidden': 'Todas as pastas estão ocultas. Mostre uma em Ajustes.',
  'settings.noneVisible':
    'Suas pastas estão vazias e ocultas. Desative «Ocultar pastas vazias» em Ajustes.',

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

  'model.label': 'Modelo',
  'model.effort': 'Raciocínio',
  'model.effortDefault': 'Padrão',
  'model.none': 'Nenhum modelo disponível',
  'model.choose': 'Escolher modelo',

  'questions.title': 'Esperando você',
  'questions.other': 'Ou escreva outra resposta…',
  'questions.submit': 'Enviar resposta',

  'time.now': 'agora',
  'time.minutes': 'há {count} min',
  'time.hours': 'há {count} h',
  'time.days': 'há {count} d',
};

const zhHans: Catalogue = {
  'action.newSession': '新建会话',
  'action.archive': '归档',
  'action.stopFirst': '请先停止当前轮次',
  'action.archived': '已归档',
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
  'settings.contrast': '对比度',
  'contrast.normal': '标准',
  'contrast.high': '高',
  'contrast.low': '低',
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
  'group.noFolder': '未分组',
  'group.emptyFolder': '这里还没有会话。',
  'group.show': '显示',
  'group.hide': '隐藏',

  'settings.title': '设置',
  'settings.folderOrder': '文件夹顺序',
  'settings.order.host': '主机顺序',
  'settings.order.name': '名称',
  'settings.order.recent': '最近活动',
  'settings.hideEmpty': '隐藏空文件夹',
  'settings.folders': '显示的文件夹',
  'settings.allHidden': '所有文件夹都已隐藏。请在设置中显示一个。',
  'settings.noneVisible': '文件夹为空且已隐藏。请在设置中关闭“隐藏空文件夹”。',

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

  'model.label': '模型',
  'model.effort': '推理强度',
  'model.effortDefault': '默认',
  'model.none': '没有可用的模型',
  'model.choose': '选择模型',

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
