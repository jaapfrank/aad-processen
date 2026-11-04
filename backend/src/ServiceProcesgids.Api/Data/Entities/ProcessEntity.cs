namespace ServiceProcesgids.Api.Data.Entities;

public sealed class ProcessEntity
{
    public string Id { get; set; } = "";
    public string Hoofdproces { get; set; } = "";
    public string Detailproces { get; set; } = "";
    public string Versie { get; set; } = "";
    public string Status { get; set; } = "concept";
    public string LaatsteWijziging { get; set; } = "";
    public int Revision { get; set; } = 1;
    public int AantalStappen { get; set; }
    public string KoppelingenJson { get; set; } = "[]";
    public string DocumentJson { get; set; } = "";
}
