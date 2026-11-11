// Convención de mensajes de commit: Conventional Commits 1.0.0
// https://www.conventionalcommits.org/en/v1.0.0/
//
//   <tipo>[alcance opcional]: <descripción>
//
//   [cuerpo opcional, una línea en blanco después del asunto]
//
//   [pies opcionales]
//
// El asunto va en español, en imperativo y sin punto final; el tipo va en
// inglés, que es lo que leen las herramientas.
//
// Existe porque el historial de este repositorio se había llenado de mensajes
// sin tipo, y eso rompe la generación de changelogs y el cálculo de versión.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Los tipos que usamos. Son los de la convención más `chore` y `ci`.
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    // Un asunto largo deja de leerse en el log.
    'header-max-length': [2, 'always', 100],
    // El cuerpo puede tener líneas largas; solo avisamos.
    'body-max-line-length': [1, 'always', 120],
    'footer-max-line-length': [1, 'always', 120],
    // En español es normal empezar el asunto con mayúscula si el sustantivo lo
    // es; no imponemos minúscula.
    'subject-case': [0],
    'subject-full-stop': [2, 'never', '.'],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
  },
};
