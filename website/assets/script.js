// British Radio Player - Interactive Support Website Script

document.addEventListener('DOMContentLoaded', () => {
  initShowcaseSwitcher();
  initFaqAccordion();
  initLightbox();
  initMobileNav();
  initScrollSpy();
});

// Interactive Screenshot Showcase Switcher
function initShowcaseSwitcher() {
  const showcaseItems = document.querySelectorAll('.showcase-nav-item');
  const showcaseImg = document.getElementById('showcase-image');

  if (!showcaseItems.length || !showcaseImg) return;

  showcaseItems.forEach(item => {
    item.addEventListener('click', () => {
      // Remove active from all
      showcaseItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      const newSrc = item.getAttribute('data-src');
      const newAlt = item.getAttribute('data-title');

      if (newSrc && showcaseImg.src !== newSrc) {
        showcaseImg.style.opacity = '0.3';
        setTimeout(() => {
          showcaseImg.src = newSrc;
          showcaseImg.alt = newAlt || 'App Screenshot';
          showcaseImg.style.opacity = '1';
        }, 150);
      }
    });
  });
}

// FAQ Accordion
function initFaqAccordion() {
  const faqItems = document.querySelectorAll('.faq-item');

  faqItems.forEach(item => {
    const questionBtn = item.querySelector('.faq-question');
    const answer = item.querySelector('.faq-answer');

    if (!questionBtn || !answer) return;

    questionBtn.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');

      // Close all other items for a clean single-open feel
      faqItems.forEach(otherItem => {
        if (otherItem !== item && otherItem.classList.contains('open')) {
          otherItem.classList.remove('open');
          const otherAnswer = otherItem.querySelector('.faq-answer');
          if (otherAnswer) otherAnswer.style.maxHeight = null;
        }
      });

      if (isOpen) {
        item.classList.remove('open');
        answer.style.maxHeight = null;
      } else {
        item.classList.add('open');
        answer.style.maxHeight = answer.scrollHeight + 'px';
      }
    });
  });
}

// Lightbox Modal for Screenshots
function initLightbox() {
  const modal = document.getElementById('lightbox-modal');
  const modalImg = document.getElementById('lightbox-image');
  const modalCaption = document.getElementById('lightbox-caption');
  const closeBtn = document.getElementById('lightbox-close');

  if (!modal || !modalImg) return;

  // Open modal from gallery cards or showcase phone
  const clickableImages = document.querySelectorAll('[data-lightbox="true"]');

  clickableImages.forEach(elem => {
    elem.addEventListener('click', () => {
      const src = elem.getAttribute('data-fullsrc') || elem.querySelector('img')?.src || elem.src;
      const caption = elem.getAttribute('data-caption') || elem.querySelector('img')?.alt || elem.alt || '';

      modalImg.src = src;
      if (modalCaption) modalCaption.textContent = caption;
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
    });
  });

  const closeModal = () => {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  };

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
      closeModal();
    }
  });
}

// Mobile Navigation Toggle
function initMobileNav() {
  const menuBtn = document.getElementById('mobile-menu-btn');
  const navLinks = document.getElementById('nav-links');

  if (!menuBtn || !navLinks) return;

  menuBtn.addEventListener('click', () => {
    navLinks.classList.toggle('mobile-open');
    const isExpanded = navLinks.classList.contains('mobile-open');
    menuBtn.setAttribute('aria-expanded', isExpanded);
    menuBtn.innerHTML = isExpanded ? '✕' : '☰';
  });

  // Close when clicking a nav link
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('mobile-open');
      menuBtn.innerHTML = '☰';
      menuBtn.setAttribute('aria-expanded', 'false');
    });
  });
}

// Scroll spy for navigation
function initScrollSpy() {
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');

  if (!sections.length || !navLinks.length) return;

  window.addEventListener('scroll', () => {
    let currentId = '';
    const scrollPos = window.scrollY + 120;

    sections.forEach(sec => {
      const top = sec.offsetTop;
      const height = sec.offsetHeight;
      if (scrollPos >= top && scrollPos < top + height) {
        currentId = sec.getAttribute('id');
      }
    });

    navLinks.forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href') === `#${currentId}`) {
        link.classList.add('active');
      }
    });
  });
}

// Copy email to clipboard function
function copyEmail(email) {
  navigator.clipboard.writeText(email).then(() => {
    const notice = document.getElementById('copy-notice');
    if (notice) {
      notice.textContent = 'Copied to clipboard!';
      setTimeout(() => {
        notice.textContent = 'Click to copy';
      }, 2000);
    }
  }).catch(() => {
    window.location.href = `mailto:${email}`;
  });
}
window.copyEmail = copyEmail;
