// <marquee> is a deprecated but still browser-supported HTML element used for the
// retro Y2K aesthetic. It isn't in React's JSX.IntrinsicElements, so declare it here
// with the one attribute this site actually uses.
declare namespace JSX {
  interface IntrinsicElements {
    marquee: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      scrollamount?: string | number;
    };
  }
}
