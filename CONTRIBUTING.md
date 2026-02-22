# Contributing to Antigravity IP Scanner

First off, thanks for taking the time to contribute! 🎉

The following is a set of guidelines for contributing to this project.

## 🌐 Translations

We actively welcome translation contributions! The app currently supports English, Persian (Farsi), and Russian.

### Adding a New Language

1. Copy `frontend/src/i18n/en.json` to `xx.json` (where `xx` is the language code)
2. Translate all ~250 keys in the JSON file
3. Update `frontend/src/i18n/LanguageContext.jsx`:
   - Import your new locale file
   - Add it to the `locales` object
   - Add your language to the `LANGUAGES` array with name and flag emoji
4. If your language is RTL, add it to the RTL check in the context provider

### Improving Existing Translations

If you notice incorrect or awkward translations in `fa.json` or `ru.json`, please open a PR with improvements.

## 🐛 Bug Reports

Open a GitHub Issue with:

1. **Description**: Clear description of the bug
2. **Steps to Reproduce**: Step-by-step instructions
3. **Expected Behavior**: What you expected to happen
4. **Actual Behavior**: What actually happened
5. **Screenshots**: If applicable
6. **Environment**: OS version, Python version, browser

## 💡 Feature Requests

Open a GitHub Issue with the `enhancement` label. Describe:

- The problem you're trying to solve
- Your proposed solution
- Any alternatives you've considered

## 🔧 Code Contributions

### Setup

```bash
git clone https://github.com/YOUR_USERNAME/CF-IP-Scanner.git
cd CF-IP-Scanner

# Backend
pip install -r backend/requirements.txt

# Frontend
cd frontend
npm install
```

### Development

```bash
# Run backend
cd backend && python main.py

# Run frontend (separate terminal)
cd frontend && npm run dev
```

### Code Style

- **Python**: Follow PEP 8, use type hints where possible
- **JavaScript/React**: Use functional components with hooks, ES6+ syntax
- **CSS**: Use Tailwind utility classes, follow existing neon theme
- **Commits**: Use [Conventional Commits](https://www.conventionalcommits.org/) format:
  - `feat:` new feature
  - `fix:` bug fix
  - `docs:` documentation
  - `style:` formatting, no logic change
  - `refactor:` code restructuring
  - `i18n:` translation updates

### Pull Request Process

1. Fork the repo and create your branch from `main`
2. Make your changes with clear, descriptive commits
3. Test your changes thoroughly
4. Update documentation if needed
5. Open a Pull Request with a clear description

## ⚖️ License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

## 🙏 Thank You!

Every contribution makes a difference in keeping the internet free and open. 🕊️
