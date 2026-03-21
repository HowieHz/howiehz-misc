export interface FrontmatterPerson {
  name?: string;
  link?: string;
  email?: string;
}

export interface NormalizedPerson {
  label: string;
  link?: string;
}

export function normalizePeople(
  input: FrontmatterPerson | FrontmatterPerson[] | string | undefined,
): NormalizedPerson[] {
  if (!input) {
    return [];
  }

  const list = Array.isArray(input) ? input : [input];

  return list
    .map((item) => {
      if (typeof item === "string") {
        return normalizeEntry({ name: item });
      }
      return normalizeEntry(item);
    })
    .filter((person): person is NormalizedPerson => Boolean(person));
}

function normalizeEntry(person?: FrontmatterPerson): NormalizedPerson | undefined {
  if (!person) {
    return undefined;
  }

  const label = person.name?.trim();
  const link = person.link?.trim();
  const email = person.email?.trim();

  if (!label) {
    return undefined;
  }

  return {
    label,
    link: buildLink(link, email),
  };
}

function buildLink(link?: string, email?: string): string | undefined {
  // 优先使用 link，link 为空或 '' 则使用 email
  if (link && link !== "") {
    return link;
  }

  if (email && email !== "") {
    const hasProtocol = email.includes("://");
    const looksLikeEmail = email.includes("@") && !hasProtocol && !email.startsWith("mailto:");

    if (looksLikeEmail) {
      return `mailto:${email}`;
    }

    return email;
  }

  return undefined;
}
