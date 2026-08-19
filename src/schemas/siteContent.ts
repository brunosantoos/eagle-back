import { z } from 'zod';

/**
 * Zod schema do SiteContent — espelha o tipo `SiteContent` do frontend
 * (eagle-front/src/lib/siteContent.ts). Mantém os dois em sincronia ao editar.
 */

const workoutCard = z.object({
  label: z.string(),
  title: z.string(),
  img: z.string(),
});

const franchiseWhyCard = z.object({
  title: z.string(),
  desc: z.string(),
  icon: z.string(),
});

const franchiseSupportItem = z.object({
  title: z.string(),
  desc: z.string(),
  icon: z.string(),
});

const heroMediaType = z.enum(['video', 'image', 'carousel']);

const homeHeroMedia = z.object({
  type: heroMediaType,
  videoUrl: z.string(),
  imageUrl: z.string(),
  carouselImages: z.array(z.string()),
});

const secondHeroConfig = z.object({
  textAlign: z.enum(['left', 'center', 'right']),
  objectPosition: z.enum(['center', 'top', 'bottom', 'left', 'right']),
  objectFit: z.enum(['cover', 'contain']),
  overlayEnabled: z.boolean(),
  overlayOpacity: z.number(),
  eyebrowColor: z.string(),
  titleColor: z.string(),
  highlightColor: z.string(),
  subtitleColor: z.string(),
});

const carouselConfig = z.object({
  title: z.string(),
  footnote: z.string(),
  titleColor: z.string(),
  footnoteColor: z.string(),
  cardTitleColor: z.string(),
  cardLabelColor: z.string(),
  cardTitleFontSize: z.number(),
  cardLabelFontSize: z.number(),
  cardOverlayOpacity: z.number(),
  sideFadeOpacity: z.number(),
});

const capitalOption = z.object({
  value: z.string(),
  label: z.string(),
});

const businessNumber = z.object({
  label: z.string(),
  value: z.string(),
});

const socialLink = z.object({
  platform: z.string(),
  url: z.string(),
});

const mediaEffect = z.object({
  maskEnabled: z.boolean(),
  maskOpacity: z.number(),
  blur: z.number(),
});

const siteMedia = z.object({
  navLogo: z.string(),
  navEagle: z.string(),
  footerLogo: z.string(),
  homeHeroVideo: z.string(),
  homeSecondHeroBg: z.string(),
  homeExperienceImage: z.string(),
  homeFranchiseTeaserImage: z.string(),
  aboutHeroBg: z.string(),
  aboutStoryImage: z.string(),
  aboutPillarsImage: z.string(),
  franchiseHeroBg: z.string(),
  franchiseHeroVideo: z.string(),
});

export const siteContentSchema = z.object({
  media: siteMedia,
  mediaEffects: z.record(z.string(), mediaEffect),
  nav: z.object({
    home: z.string(),
    about: z.string(),
    franchise: z.string(),
  }),
  privacyPolicy: z.object({
    title: z.string(),
    content: z.string(),
  }),
  termsOfUse: z.object({
    title: z.string(),
    content: z.string(),
  }),
  footer: z.object({
    tagline: z.string(),
    navTitle: z.string(),
    franchiseColumnTitle: z.string(),
    contactTitle: z.string(),
    addressLine1: z.string(),
    addressLine2: z.string(),
    phone: z.string(),
    email: z.string(),
    copyrightName: z.string(),
    terms: z.string(),
    privacy: z.string(),
    linkHome: z.string(),
    linkAbout: z.string(),
    linkFranchise: z.string(),
    franchiseLink1: z.string(),
    franchiseLink2: z.string(),
    franchiseLink3: z.string(),
    socialTitle: z.string(),
    socialDescription: z.string(),
    mapsUrl: z.string(),
    socialLinks: z.array(socialLink),
  }),
  home: z.object({
    heroMedia: homeHeroMedia,
    hero: z.object({
      eyebrow: z.string(),
      titleLine1: z.string(),
      titleHighlight: z.string(),
      subtitle: z.string(),
    }),
    secondHero: secondHeroConfig,
    experience: z.object({
      titleLine1: z.string(),
      titleLine2: z.string(),
      body: z.string(),
      bullets: z.array(z.string()),
    }),
    carousel: carouselConfig,
    workouts: z.array(workoutCard),
    franchiseTeaser: z.object({
      eyebrow: z.string(),
      titlePart1: z.string(),
      titleGradient: z.string(),
      body: z.string(),
      cta: z.string(),
    }),
  }),
  about: z.object({
    heroTitle: z.string(),
    storyTitle: z.string(),
    storyParagraphs: z.array(z.string()),
    heroTitleColor: z.string(),
    heroMaskEnabled: z.boolean(),
    heroMaskOpacity: z.number(),
    pillarsMaskEnabled: z.boolean(),
    pillarsTitle: z.string(),
    pillarsIntro: z.string(),
    pillarsHeadline: z.string(),
    pillarsOutro: z.string(),
    missionTitle: z.string(),
    missionDesc: z.string(),
    visionTitle: z.string(),
    visionDesc: z.string(),
    valuesTitle: z.string(),
    valuesDesc: z.string(),
  }),
  franchise: z.object({
    heroEyebrow: z.string(),
    heroTitleBefore: z.string(),
    heroTitleHighlight: z.string(),
    heroBody: z.string(),
    heroCta: z.string(),
    whyTitle: z.string(),
    whyBody: z.string(),
    whyCards: z.array(franchiseWhyCard),
    supportTitle: z.string(),
    supportBody: z.string(),
    supportItems: z.array(franchiseSupportItem),
    numbersTitle: z.string(),
    numbers: z.array(businessNumber),
    numbersDisclaimer: z.string(),
    formTitle: z.string(),
    formSubtitle: z.string(),
    labelName: z.string(),
    labelEmail: z.string(),
    labelPhone: z.string(),
    labelCity: z.string(),
    labelCapital: z.string(),
    placeholderName: z.string(),
    placeholderEmail: z.string(),
    placeholderPhone: z.string(),
    placeholderCity: z.string(),
    selectCapitalPlaceholder: z.string(),
    capitalOptions: z.array(capitalOption),
    submitButton: z.string(),
    formSuccessMessage: z.string(),
  }),
});

export type SiteContent = z.infer<typeof siteContentSchema>;
