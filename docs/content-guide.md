# Content Update Guide

## Add a new project
1. Create a Markdown file in `src/content/projects/`.
2. Use existing frontmatter shape from existing examples.
3. Add hero/gallery images into `public/images/`.
4. Run `npm run build` to validate schema.

## Add a new update
1. Create a Markdown file in `src/content/updates/`.
2. Include `title`, `summary`, `date`, `category`, and `featured`.
3. Run `npm run build`.

## Update configurator catalog
1. Edit `src/data/configurator/components.json`.
2. Keep category IDs and component category values aligned.
3. Adjust `src/data/configurator/rules.json` as needed.
4. Run tests with `npm test`.
