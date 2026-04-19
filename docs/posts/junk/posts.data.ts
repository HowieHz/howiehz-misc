import { createCategoryLoader } from "../../.vitepress/data/category-loader";
import type { CategoryPostMeta } from "../../.vitepress/data/category-loader";
import type { ContentLoader } from "../../.vitepress/data/content-loader";

const postsData: ContentLoader<CategoryPostMeta[]> = createCategoryLoader("posts/junk/*.md", "/posts/junk/");

export default postsData;
