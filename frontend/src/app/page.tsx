import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { LoanList } from "@/components/LoanList";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Header />
      <Hero />
      <LoanList />
      <Footer />
    </>
  );
}
