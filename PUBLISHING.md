# 上传到 GitHub

本项目仓库：[jackold701-lang/bilibili-comment-part-seek](https://github.com/jackold701-lang/bilibili-comment-part-seek)。以下步骤适用于项目分叉或重新发布：

## 在网页中上传

进入新仓库，选择 **Add file → Upload files**，将本项目目录里的文件和 `test` 文件夹拖入上传区，然后提交。上传的是项目文件，不是本项目的 ZIP 压缩包。GitHub 的[文件上传说明](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)支持拖入文件夹。

## 用 Git 上传

在本项目目录打开终端，依次运行：

```sh
git init -b main
git add .
git commit -m "Initial open source release"
git remote add origin https://github.com/你的用户名/bilibili-comment-part-seek.git
git push -u origin main
```

把 `你的用户名` 改成自己的 GitHub 用户名。如果已建立本地 Git 仓库，跳过 `git init -b main`。这与 [GitHub 官方的本地代码上传流程](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)一致。

分叉后，应把脚本元数据中的 `@namespace`、`@homepageURL`、`@supportURL`、`@updateURL` 和 `@downloadURL` 改成自己的仓库地址，并在发布更新时提高 `@version`。
