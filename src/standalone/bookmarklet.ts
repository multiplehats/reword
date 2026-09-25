import { boot } from './boot';

const existing = window.Reword;
if (existing) existing.toggle();
else void boot('bookmarklet').open();
