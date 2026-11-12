import { webMethod, Permissions } from '@wix/web-methods';
import { members } from '@wix/members';
import { items } from '@wix/data';
import { auth } from '@wix/essentials';

const COLLECTIONS = {
  authors: 'WaveAuthors',
  works: 'WaveWorks',
  chapters: 'WaveChapters',
};

const queryElevated = auth.elevate(items.query);
const getElevated = auth.elevate(items.get);
const insertElevated = auth.elevate(items.insert);
const updateElevated = auth.elevate(items.update);

async function requireMember() {
  const member = await members.getCurrentMember();
  if (!member || !member._id) {
    throw new Error('A signed-in site member is required.');
  }
  return member;
}

async function findAuthor(memberId) {
  const result = await queryElevated(COLLECTIONS.authors)
    .eq('memberId', memberId)
    .limit(1)
    .find();

  return result.items[0] || null;
}

async function requireAuthor(memberId) {
  const author = await findAuthor(memberId);
  if (!author) {
    throw new Error('Create an author profile before creating works or chapters.');
  }
  return author;
}

function cleanText(value, fieldName, maxLength) {
  if (typeof value !== 'string') {
    throw new Error(fieldName + ' must be text.');
  }

  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maxLength) {
    throw new Error(fieldName + ' is required and must be no longer than ' + maxLength + ' characters.');
  }

  return cleaned;
}

export const getMyAuthorProfile = webMethod(
  Permissions.SiteMember,
  async () => {
    const member = await requireMember();
    return findAuthor(member._id);
  }
);

export const createMyAuthorProfile = webMethod(
  Permissions.SiteMember,
  async (input) => {
    const member = await requireMember();
    if (await findAuthor(member._id)) {
      throw new Error('An author profile already exists for this member.');
    }

    const displayName = cleanText(input?.displayName, 'Display name', 80);
    const biography = typeof input?.biography === 'string'
      ? input.biography.slice(0, 5000)
      : '';

    const author = await insertElevated(COLLECTIONS.authors, {
      memberId: member._id,
      displayName,
      biography,
      profileStatus: 'DRAFT',
      createdAt: new Date(),
    });

    return {
      _id: author._id,
      displayName: author.displayName,
      biography: author.biography,
      profileStatus: author.profileStatus,
    };
  }
);

export const createMyDraftWork = webMethod(
  Permissions.SiteMember,
  async (input) => {
    const member = await requireMember();
    const author = await requireAuthor(member._id);
    const title = cleanText(input?.title, 'Title', 160);
    const synopsis = typeof input?.synopsis === 'string'
      ? input.synopsis.slice(0, 10000)
      : '';

    const work = await insertElevated(COLLECTIONS.works, {
      authorId: author._id,
      title,
      slug: '',
      synopsis,
      genres: [],
      tags: [],
      contentRating: 'UNRATED',
      contentWarnings: [],
      rightsCategory: 'UNDECLARED',
      rightsClearanceStatus: 'PENDING',
      publicationStatus: 'DRAFT',
      language: 'en',
      updatedAt: new Date(),
    });

    return {
      _id: work._id,
      title: work.title,
      publicationStatus: work.publicationStatus,
      rightsClearanceStatus: work.rightsClearanceStatus,
    };
  }
);

export const updateMyDraftWork = webMethod(
  Permissions.SiteMember,
  async (workId, input) => {
    const member = await requireMember();
    const author = await requireAuthor(member._id);

    if (typeof workId !== 'string' || !workId.trim()) {
      throw new Error('A work ID is required.');
    }

    const existing = await getElevated(COLLECTIONS.works, workId);
    if (!existing || existing.authorId !== author._id) {
      throw new Error('The work was not found for this author.');
    }
    if (existing.publicationStatus !== 'DRAFT') {
      throw new Error('Only unpublished drafts can be edited through this method.');
    }

    const updated = { ...existing };
    if (Object.prototype.hasOwnProperty.call(input || {}, 'title')) {
      updated.title = cleanText(input.title, 'Title', 160);
    }
    if (Object.prototype.hasOwnProperty.call(input || {}, 'synopsis')) {
      if (typeof input.synopsis !== 'string' || input.synopsis.length > 10000) {
        throw new Error('Synopsis must be text no longer than 10000 characters.');
      }
      updated.synopsis = input.synopsis;
    }
    if (Object.prototype.hasOwnProperty.call(input || {}, 'language')) {
      updated.language = cleanText(input.language, 'Language', 35);
    }
    updated.updatedAt = new Date();

    const saved = await updateElevated(COLLECTIONS.works, updated);
    return {
      _id: saved._id,
      title: saved.title,
      synopsis: saved.synopsis,
      publicationStatus: saved.publicationStatus,
    };
  }
);

export const createMyDraftChapter = webMethod(
  Permissions.SiteMember,
  async (workId, input) => {
    const member = await requireMember();
    const author = await requireAuthor(member._id);

    if (typeof workId !== 'string' || !workId.trim()) {
      throw new Error('A work ID is required.');
    }

    const work = await getElevated(COLLECTIONS.works, workId);
    if (!work || work.authorId !== author._id) {
      throw new Error('The work was not found for this author.');
    }
    if (work.publicationStatus !== 'DRAFT') {
      throw new Error('Chapters can only be added to an unpublished draft through this method.');
    }

    const title = cleanText(input?.title, 'Chapter title', 160);
    if (typeof input?.body !== 'string' || !input.body.trim() || input.body.length > 450000) {
      throw new Error('Chapter body is required and must be no longer than 450000 characters.');
    }

    const prior = await queryElevated(COLLECTIONS.chapters)
      .eq('workId', workId)
      .limit(1000)
      .find();

    const chapterNumber = prior.items.reduce((maximum, chapter) => {
      return Math.max(maximum, Number(chapter.chapterNumber) || 0);
    }, 0) + 1;

    const chapter = await insertElevated(COLLECTIONS.chapters, {
      workId,
      authorId: author._id,
      chapterNumber,
      title,
      body: input.body,
      publicationStatus: 'DRAFT',
      updatedAt: new Date(),
    });

    return {
      _id: chapter._id,
      workId: chapter.workId,
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      publicationStatus: chapter.publicationStatus,
    };
  }
);
