declare const StarlightThemeProvider: {
	choice: 'dark' | 'light' | 'auto';
	resolve(choice: string): 'dark' | 'light';
	updatePickers(theme?: string): void;
};
