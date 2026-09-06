using System;

namespace Ledger
{
    // A plain class beside the forms: no designer body, so no reader claims it.
    internal static class Helpers
    {
        public static string Trim(string s) { return s == null ? "" : s.Trim(); }
    }
}
