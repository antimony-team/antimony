// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightOpenAPI, { openAPISidebarGroups } from 'starlight-openapi';

// https://astro.build/config
export default defineConfig({
	site: 'https://antimony-team.github.io',
	base: '/antimony',
	integrations: [
		starlight({
			title: 'Antimony',
			description: 'Draw the network. Antimony runs it. Design, deploy and operate containerlab labs from your browser.',
			logo: { src: './src/assets/logo.svg' },
			favicon: '/favicon.svg',
			plugins: [
				starlightOpenAPI([
					{
						base: 'docs/api/rest',
						schema: './openapi/antimony.swagger.json',
						sidebar: { label: 'REST API' },
					},
				]),
			],
			customCss: ['./src/styles/fonts.css', './src/styles/docs.css'],
			components: {
				ThemeProvider: './src/components/starlight/ThemeProvider.astro',
				ThemeSelect: './src/components/starlight/ThemeSelect.astro',
			},
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/antimony-team/antimony' },
			],
			editLink: {
				baseUrl: 'https://github.com/antimony-team/antimony/edit/main/site/',
			},
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Introduction', slug: 'docs' },
						'docs/getting-started/quick-start',
						'docs/getting-started/concepts',
					],
				},
				{
					label: 'Deployment',
					items: [
						'docs/deployment/docker',
						'docs/deployment/clabernetes',
						'docs/deployment/desktop-app',
						'docs/deployment/configuration',
						'docs/deployment/authentication',
					],
				},
				{
					label: 'User Manual',
					items: [
						'docs/manual/dashboard',
						'docs/manual/topology-editor',
						'docs/manual/deploying-labs',
						'docs/manual/lab-view',
						'docs/manual/ssh-server',
					],
				},
				{
					label: 'Architecture',
					items: [
						'docs/architecture/overview',
						'docs/architecture/lab-lifecycle',
						'docs/architecture/auth-flow',
					],
				},
				{
					label: 'API',
					items: [...openAPISidebarGroups, 'docs/api/socket-io'],
				},
				{
					label: 'Development',
					items: ['docs/development/setup', 'docs/development/glossary'],
				},
			],
		}),
	],
});
